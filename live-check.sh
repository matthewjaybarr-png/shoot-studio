# Drive the real Shoot Studio window on a hidden Hyprland monitor, without taking keyboard focus.
# Usage: . shoot-studio/live-check.sh; start <folder>; key Down Return c; shot name; stop
# Screenshots go to /tmp/ss-shots/. Only point it at disposable test folders: the app writes <folder>/.shootstudio/.
APP=$(dirname "$(realpath "${BASH_SOURCE[0]}")")/src-tauri/target/release/shoot-studio
SHOTS=/tmp/ss-shots
addr() { hyprctl clients -j | python3 -c "import json,sys;print(next((c['address'] for c in json.load(sys.stdin) if c['title']=='Shoot Studio'),''))"; }
key() { for k in "$@"; do hyprctl dispatch "hl.dsp.send_shortcut({ mods = \"\", key = \"$k\", window = \"address:$(addr)\" })" >/dev/null; sleep 0.15; done; }
shot() { mkdir -p $SHOTS; grim -o SHOOTTEST -s "${2:-0.5}" "$SHOTS/$1.png"; }
start() {
  hyprctl monitors -j | grep -q SHOOTTEST || hyprctl output create headless SHOOTTEST >/dev/null
  local ws=$(hyprctl monitors -j | python3 -c "import json,sys;print(next(m['activeWorkspace']['name'] for m in json.load(sys.stdin) if m['name']=='SHOOTTEST'))")
  (SHOOT_STUDIO_OPEN=$1 setsid "$APP" >/dev/null 2>&1 &)
  local a=""; for i in $(seq 40); do sleep 0.25; a=$(addr); [ -n "$a" ] && break; done
  hyprctl dispatch "hl.dsp.window.move({ workspace = \"$ws\", follow = false, window = \"address:$a\" })" >/dev/null
  sleep 2
}
quit() { pkill -f "$APP"; sleep 1; }
stop() { quit; hyprctl output remove SHOOTTEST >/dev/null; }
