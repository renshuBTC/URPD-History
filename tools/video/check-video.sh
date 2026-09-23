#!/usr/bin/env bash
# Checks that FILE is the video the ▶ button promises and nothing else: an .mp4 holding exactly one stream, H.264
# video at 3840x2160 and 60 fps, 18,000 frames (5:00), of a plausible size. With --decode it also decodes every
# frame, which a malformed stream would not survive. Exits 1, saying why, if anything is off.
#
#   bash tools/video/check-video.sh FILE [--decode]     (needs ffprobe and jq; env FRAMES, default 18000)
set -euo pipefail
f=$1; frames=${FRAMES:-18000}
fail() { echo "check-video: $f: $*" >&2; exit 1; }
[ -f "$f" ] || fail "no such file"
case "$f" in *.mp4) ;; *) fail "not named .mp4" ;; esac
size=$(stat -c %s "$f")
min=$((frames * 1000)); max=2000000000     # at least 1 KB a frame; under GitHub's 2 GiB limit for a release file
[ "$size" -ge "$min" ] && [ "$size" -lt "$max" ] || fail "$size bytes is outside $min .. $max"
[ "$(head -c 8 "$f" | tail -c 4)" = ftyp ] || fail "does not begin with an MP4 ftyp box"
info=$(ffprobe -v error -show_entries format=format_name,duration,nb_streams:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,nb_frames -of json "$f") || fail "ffprobe cannot read it"
q() { jq -r "$1" <<< "$info"; }
[ "$(q .format.format_name)" = "mov,mp4,m4a,3gp,3g2,mj2" ] || fail "container is $(q .format.format_name)"
[ "$(q .format.nb_streams)" = 1 ] || fail "$(q .format.nb_streams) streams, not 1"
got="$(q '.streams[0].codec_type') $(q '.streams[0].codec_name') $(q '.streams[0].width')x$(q '.streams[0].height') $(q '.streams[0].pix_fmt') $(q '.streams[0].avg_frame_rate') $(q '.streams[0].nb_frames')"
[ "$got" = "video h264 3840x2160 yuv420p 60/1 $frames" ] || fail "is '$got', not 'video h264 3840x2160 yuv420p 60/1 $frames'"
awk -v d="$(q .format.duration)" -v n="$frames" 'BEGIN { exit !(d > n / 60 - 0.1 && d < n / 60 + 0.1) }' || fail "lasts $(q .format.duration) s, not $((frames / 60))"
if [ "${2:-}" = --decode ]; then
  err=$(mktemp)
  n=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$f" 2> "$err") || fail "cannot be decoded: $(head -c 300 "$err")"
  [ ! -s "$err" ] || fail "decoding reported: $(head -c 300 "$err")"
  [ "$(tr -d '[:space:]' <<< "$n")" = "$frames" ] || fail "decoded $n frames, not $frames"
  rm -f "$err"
fi
echo "check-video: $(basename "$f") is a $frames-frame 3840x2160 60 fps H.264 video, $size bytes$([ "${2:-}" = --decode ] && echo ', every frame decoded')"
