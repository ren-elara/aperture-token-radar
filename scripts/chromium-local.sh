#!/bin/sh
APERTURE_ROOT="/public/farm/ren-elara/agent-2/.browser-root"
export LD_LIBRARY_PATH="$APERTURE_ROOT/usr/lib:$APERTURE_ROOT/lib:$APERTURE_ROOT/usr/lib/chromium:$APERTURE_ROOT/usr/lib/pulseaudio"
exec "$APERTURE_ROOT/usr/lib/chromium/chrome" "$@"
