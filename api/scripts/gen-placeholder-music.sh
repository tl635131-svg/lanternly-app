#!/usr/bin/env bash
# Regenerates the placeholder music library in assets/music/.
# Each file is an original, synthesized chord: sine tones with staggered note entries,
# a gentle tremolo and fades, 8 seconds, mono, 64 kbps MP3. Nothing is sampled
# or copied, so there are no licensing concerns. They are dev placeholders only:
# replace them with licensed tracks before launch.
set -euo pipefail
cd "$(dirname "$0")/.."
out=assets/music
mkdir -p "$out"
D=8

# slug | tremolo Hz | note frequencies (Hz)
tracks=(
  "first-light-waltz|0.75|261.63 329.63 392.00"
  "harbour-morning|0.50|196.00 246.94 293.66"
  "garden-strings|1.10|220.00 261.63 329.63"
  "slow-dance-in-june|0.60|174.61 220.00 261.63"
  "lantern-glow|0.40|293.66 369.99 440.00"
  "paper-boats|1.50|329.63 415.30 493.88"
  "evening-promenade|0.90|233.08 293.66 349.23 440.00"
  "northern-vows|0.30|164.81 196.00 246.94"
)

for row in "${tracks[@]}"; do
  IFS='|' read -r slug trem freqs <<<"$row"
  expr=""
  i=0
  n=$(wc -w <<<"$freqs")
  for f in $freqs; do
    start=$(awk "BEGIN{print $i*0.45}")
    # each note enters in turn (arpeggio) and holds; soft 2nd harmonic for warmth
    term="gte(t,$start)*(sin(2*PI*$f*t)+0.25*sin(4*PI*$f*t))"
    expr="${expr:+$expr+}$term"
    i=$((i+1))
  done
  gain=$(awk "BEGIN{printf \"%.3f\", 0.5/$n}")
  full="$gain*($expr)*(0.85+0.15*sin(2*PI*$trem*t))*min(1,t/0.8)*min(1,($D-t)/2)"
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "aevalsrc=exprs='$full':s=44100:d=$D" \
    -ac 1 -codec:a libmp3lame -b:a 64k \
    -metadata title="$slug (placeholder)" -metadata artist="Studio Library (placeholder)" \
    -metadata comment="Original synthesized placeholder - replace before launch" \
    "$out/$slug.mp3"
  echo "wrote $out/$slug.mp3"
done
