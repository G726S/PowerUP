"""Narrated video summary: script (text, one BEAT per short visual moment)
-> beats are grouped into SEGMENTS -> one narration audio call per segment
(concatenating that segment's beats) -> each beat gets its own stroke-drawn
whiteboard diagram (diagram_renderer.py), shown for a slice of the segment's
audio proportional to how much of the narration that beat covers -> all
segments concatenated into an mp4.

Why segments of multiple beats instead of one call per beat: the
narration-audio model has a very tight free-tier quota (10 requests/day,
see gemini_client.py), so a long, fully-comprehensive video needs many more
visual moments than it can afford individual TTS calls for. Batching several
beats' narration into one TTS call keeps the video's TTS-call count low
(BEATS_PER_SEGMENT beats per call) while still covering the whole document
in real depth, and still lets each beat get its own distinct hand-drawn
visual instead of holding one diagram static for 30+ seconds. (AI-illustrated
visuals were considered too -- every image-generation model on this API key
returns 0 free-tier quota -- so this draws shapes/text locally instead of
generating imagery.)"""

import json
import os
import sys
import tempfile
import wave
from typing import Any

from google.genai import types
from moviepy import AudioFileClip, VideoClip, concatenate_videoclips

from diagram_renderer import DiagramFields, normalize_diagram_dict, render_diagram_frame
from text_dedup import is_degenerate_repetition, is_near_duplicate
from gemini_client import (
    MODEL_NAME,
    PLAIN_TEXT_MATH_RULE,
    TTS_MODEL_NAME,
    TTS_SAMPLE_RATE,
    TTS_VOICE,
    call_with_backoff,
    client,
)

DEFAULT_VIDEO_BEATS = 12
BEATS_PER_SEGMENT = 3  # -> 1 TTS call per 3 beats
MIN_BEAT_SECONDS = 1.5  # floor so a very short beat doesn't flash by unreadably


class VideoBeatItem(DiagramFields):
    title: str
    narration: str


def build_beat_prompt(context_text: str, beat_index: int, num_beats: int, avoid_titles: list[str]) -> str:
    avoid_block = ""
    if avoid_titles:
        avoid_block = (
            "\n\nThese beats already exist earlier in the video -- pick a different topic, not a rehash of "
            "any of them: " + "; ".join(avoid_titles)
        )

    return (
        f"This is beat {beat_index} of {num_beats} in a single continuous narrated educational video that "
        "teaches the ENTIRE study context below in real depth -- not a short highlights summary, a full "
        "walkthrough a student could learn the whole material from without reading the source again. Each "
        "beat is one short visual moment (a few seconds) with its own narration and its own hand-drawn "
        f"diagram; consecutive beats read naturally back-to-back like one teacher talking. Beat {beat_index} "
        f"of {num_beats} should cover whatever slice of the material fits at that point in a logical "
        "progression through every distinct topic/section/sub-point in the document (overview first, then "
        "work through details, examples, and any comparisons or processes in the material one at a time)."
        + avoid_block + "\n\n"
        "Provide a short 'title', a 'narration' string (1-3 natural spoken sentences -- this is only one "
        "beat's worth of speech, not a whole slide's), and pick exactly ONE 'diagram_type' that best fits "
        "this beat's specific content, filling in only that type's fields (leave every other type's fields "
        "as empty strings/lists):\n\n"
        "- \"process\": a sequence of steps, a pipeline, or an algorithm/workflow. Fill 'process_steps' "
        "with 3-6 short step labels in order.\n"
        "- \"comparison\": two things being contrasted (X vs Y, method A vs method B). Fill "
        "'comparison_left_label', 'comparison_left_points' (2-4 short points), 'comparison_right_label', "
        "'comparison_right_points' (2-4 short points).\n"
        "- \"definition\": one key term being introduced/defined. Fill 'definition_term' (the term, short) "
        "and 'definition_text' (a clear one-sentence definition).\n"
        "- \"timeline\": a chronological or ordered sequence of milestones/stages (not a how-to process). "
        "Fill 'timeline_events' with 3-6 short ordered labels.\n"
        "- \"text\": for a point that's genuinely better explained in written words than forced into a "
        "shape -- a nuance, a caveat, a written-out explanation, a key takeaway. Fill 'text_points' with "
        "2-4 short WRITTEN SENTENCES (this is the one type where full sentences on screen are correct, not "
        "just a few words -- the viewer reads these like on-screen notes while the narrator talks).\n"
        "- \"table\": structured/tabular data with several items compared across the same few attributes "
        "(more than two items, or more than one dimension of comparison -- for exactly two things use "
        "'comparison' instead). Fill 'table_headers' (2-4 short column names) and 'table_rows' (2-5 rows; "
        "each row is ONE string with its cells separated by ' | ', e.g. 'K-Means | Unsupervised | Clustering', "
        "in the same order as the headers).\n"
        "- \"concept\": the default -- one main idea with several supporting points/examples/sub-topics that "
        "don't form a sequence, timeline, definition, table, or two-way comparison. Fill 'concept_center' "
        "(the main idea, short) and 'concept_branches' (3-5 short supporting points).\n\n"
        "Prefer variety across the video -- don't pick 'concept' for everything just because it's the "
        "default; use whichever type actually matches this beat's content, and don't be afraid to reach for "
        "'text' when the point is more naturally said in a sentence than drawn as a shape, or 'table' when "
        "there's real tabular data in the material.\n\n"
        "Keep every field SHORT (a few words each, not full sentences) EXCEPT 'text_points', which should be "
        "full written sentences -- these are drawn as labels on shapes (or, for 'text', as short read-along "
        "sentences), not as long body paragraphs, since the narration is where the actual explaining happens."
        "\n\n" + PLAIN_TEXT_MATH_RULE + " This applies to the narration too, since it is read aloud by a "
        "text-to-speech voice -- write any formula as you'd say it out loud, not as symbols.\n\n"
        "--- Study context ---\n" + context_text
    )


def _request_single_beat(
    context_text: str, beat_index: int, num_beats: int, avoid_titles: list[str]
) -> dict[str, Any] | None:
    """One beat per call, same reliability fix as notes_generator's
    single-topic approach -- asking gemini-3.5-flash-lite for several
    structured items in one batched call is unreliable (it occasionally
    runs away mid-field and truncates the JSON, seen live as 'Unterminated
    string...' failures), so each beat gets its own call and retry budget."""
    # Only the last few titles are passed to the model as "already covered"
    # -- an unbounded, ever-growing list makes the prompt longer and more
    # constrained with every beat, which seemed to correlate with the model
    # degenerating into JSON-truncating rambling more often deep into a
    # long video (empirically: a 17-beat run lost 13/17 to this).
    prompt = build_beat_prompt(context_text, beat_index, num_beats, avoid_titles[-8:])
    response = call_with_backoff(
        client.models.generate_content,
        model=MODEL_NAME,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=VideoBeatItem,
            max_output_tokens=3072,  # 'text' beats need full sentences, not just short labels
            temperature=0.6,  # lower than the API default -- less prone to rambling into truncation
        ),
    )
    if response.parsed is not None:
        item = response.parsed.model_dump()
    else:
        item = json.loads(response.text)  # fallback if .parsed wasn't populated

    title = str(item.get("title", "")).strip()
    narration = str(item.get("narration", "")).strip()
    if not title or not narration:
        return None
    if is_degenerate_repetition(narration):
        # Don't let a looped phrase reach the TTS call -- that would burn a
        # scarce daily TTS request synthesizing garbage audio for nothing.
        print(f"Warning: beat '{title}' narration was degenerate repetition, discarding", file=sys.stderr)
        return None

    diagram = normalize_diagram_dict(item, fallback_center=title)
    if diagram is None:
        return None  # nothing to draw at all -- skip rather than show an empty hub

    return {"title": title, "narration": narration, **diagram}


def generate_video_beats(context_text: str, num_beats: int) -> list[dict[str, Any]]:
    beats: list[dict[str, Any]] = []
    titles: list[str] = []
    seen_titles: set[str] = set()
    for i in range(1, num_beats + 1):
        beat = None
        for attempt in range(4):
            try:
                candidate = _request_single_beat(context_text, i, num_beats, titles)
                if candidate and is_near_duplicate(candidate["title"], seen_titles):
                    # The model repeated (or lightly reworded) an earlier beat instead of
                    # finding something new -- happens once a short document runs out of
                    # genuinely distinct content. Don't accept it; retry for a fresh angle.
                    print(
                        f"Warning: video beat {i} attempt {attempt + 1} was a near-duplicate of an "
                        f"earlier beat ('{candidate['title']}'), retrying",
                        file=sys.stderr,
                    )
                    continue
                beat = candidate
                if beat:
                    break
            except Exception as e:
                print(f"Warning: video beat {i} generation attempt {attempt + 1} failed: {e}", file=sys.stderr)
        if beat:
            beats.append(beat)
            titles.append(beat["title"])
            seen_titles.add(beat["title"])
        else:
            print(f"Warning: giving up on video beat {i} after retries, continuing with the rest", file=sys.stderr)
    return beats


def _group_into_segments(beats: list[dict[str, Any]], beats_per_segment: int) -> list[list[dict[str, Any]]]:
    return [beats[i : i + beats_per_segment] for i in range(0, len(beats), beats_per_segment)]


def synthesize_narration(text: str) -> bytes:
    """Returns raw 16-bit PCM mono audio at TTS_SAMPLE_RATE Hz."""
    response = call_with_backoff(
        client.models.generate_content,
        model=TTS_MODEL_NAME,
        contents=text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=TTS_VOICE)
                )
            ),
        ),
    )
    return response.candidates[0].content.parts[0].inline_data.data


def _write_wav(path: str, pcm_bytes: bytes) -> None:
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(TTS_SAMPLE_RATE)
        wf.writeframes(pcm_bytes)


def _beat_time_slices(beats: list[dict[str, Any]], total_duration: float) -> list[tuple[float, float]]:
    """Splits total_duration across beats proportional to each beat's
    narration word count (no word-level timestamps from the TTS API, so
    this is an approximation -- close enough for a whiteboard video where
    the diagram just needs to roughly track what's being said), with a
    floor per beat so a very short narration doesn't flash by unreadably."""
    word_counts = [max(len(b["narration"].split()), 1) for b in beats]
    total_words = sum(word_counts)

    raw = [total_duration * wc / total_words for wc in word_counts]
    floored = [max(d, min(MIN_BEAT_SECONDS, total_duration / len(beats))) for d in raw]

    # Floors can push the total past total_duration -- rescale proportionally
    # so slices still exactly tile [0, total_duration] for the audio clip.
    scale = total_duration / sum(floored) if sum(floored) else 1.0
    durations = [d * scale for d in floored]

    slices = []
    cursor = 0.0
    for d in durations:
        slices.append((cursor, cursor + d))
        cursor += d
    return slices


def _build_segment_clip(beats: list[dict[str, Any]], audio_clip: AudioFileClip) -> VideoClip:
    duration = audio_clip.duration
    slices = _beat_time_slices(beats, duration)

    def make_frame(t: float):
        last = len(beats) - 1
        for i, (beat, (start, end)) in enumerate(zip(beats, slices)):
            if t < end or i == last:
                local_t = min(max(t - start, 0.0), end - start)
                return render_diagram_frame(beat["diagram_type"], beat, local_t, end - start)

    return VideoClip(make_frame, duration=duration).with_audio(audio_clip)


def build_narrated_video(context_text: str, num_beats: int, out_path: str) -> list[dict[str, Any]]:
    """Generates a beat-by-beat script covering the whole document, groups
    beats into segments sharing one narration audio call each, builds each
    segment's clip (each beat inside it gets its own diagram drawn for its
    slice of the segment's audio), and writes the assembled mp4 to
    out_path. Returns the flat beat list used."""
    beats = generate_video_beats(context_text, num_beats)
    if not beats:
        raise ValueError("No content was generated for the video summary.")

    segments = _group_into_segments(beats, BEATS_PER_SEGMENT)

    tmp_wav_paths: list[str] = []
    try:
        clips = []
        for segment_beats in segments:
            joined_narration = " ".join(b["narration"] for b in segment_beats)
            pcm = synthesize_narration(joined_narration)
            wav_path = tempfile.NamedTemporaryFile(suffix=".wav", delete=False).name
            tmp_wav_paths.append(wav_path)
            _write_wav(wav_path, pcm)

            audio_clip = AudioFileClip(wav_path)
            clips.append(_build_segment_clip(segment_beats, audio_clip))

        final_clip = concatenate_videoclips(clips)
        final_clip.write_videofile(out_path, fps=15, codec="libx264", audio_codec="aac", logger=None)
    finally:
        for path in tmp_wav_paths:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass

    return beats
