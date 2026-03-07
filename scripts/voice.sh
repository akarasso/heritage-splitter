#!/bin/bash
TMPFILE=$(mktemp /tmp/voice-XXXXX.wav)
echo "🎙️  Parle maintenant... (Entrée pour arrêter)"
arecord -f S16_LE -r 16000 -c 1 -q "$TMPFILE" &
PID=$!
read -r _
kill $PID 2>/dev/null
wait $PID 2>/dev/null
echo "⏳ Transcription..."
TEXT=$(~/whisper.cpp/build/bin/whisper-cli -m ~/whisper.cpp/models/ggml-medium.bin -l fr -f "$TMPFILE" --no-timestamps -nt 2>/dev/null | sed '/^$/d' | sed 's/^ *//g')
rm "$TMPFILE"
echo ""
echo "📝 $TEXT"
