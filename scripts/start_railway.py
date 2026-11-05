"""
Unified Railway Startup Launcher.
Allows running both the Web Management Dashboard and the Account Token Refresh Bot
within the same Railway deployment service, or running the web service independently.
"""

import os
import sys
import subprocess
import time
import signal


def main():
    print("=" * 65)
    print("Railway Application Startup Launcher")
    print("=" * 65)

    bot_token = (
        os.getenv("REFRESH_BOT_TOKEN")
        or os.getenv("TELEGRAM_REFRESH_BOT_TOKEN")
        or ""
    ).strip()

    bot_proc = None

    # 1. Start Token Refresh Bot if token is configured
    if bot_token:
        print("[Launcher] Detected REFRESH_BOT_TOKEN. Launching Account Token Refresh Bot in background...")
        bot_script = os.path.join(os.path.dirname(os.path.dirname(__file__)), "token_refresh_bot", "bot.py")
        bot_proc = subprocess.Popen(
            [sys.executable, "-u", bot_script],
            cwd=os.getcwd(),
            env=os.environ
        )
        print(f"[Launcher] Token Refresh Bot process spawned (PID: {bot_proc.pid}).")
    else:
        print("[Launcher] REFRESH_BOT_TOKEN not provided. Token Refresh Bot is disabled.")

    # 2. Start Web Application
    print("[Launcher] Starting Web Application (npm run start)...")
    npm_cmd = "npm.cmd" if sys.platform == "win32" else "npm"
    web_proc = subprocess.Popen([npm_cmd, "run", "start"], cwd=os.getcwd())

    # Forward termination signals
    def handle_shutdown(signum, frame):
        print("[Launcher] Shutdown signal received. Terminating processes...")
        if bot_proc and bot_proc.poll() is None:
            bot_proc.terminate()
        if web_proc and web_proc.poll() is None:
            web_proc.terminate()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_shutdown)
    signal.signal(signal.SIGTERM, handle_shutdown)

    # Monitor web process and ensure bot stays alive
    try:
        while web_proc.poll() is None:
            # Check bot process health
            if bot_token and (bot_proc is None or bot_proc.poll() is not None):
                print("[Launcher] Token Refresh Bot process is stopped. (Re)starting in background...")
                bot_proc = subprocess.Popen(
                    [sys.executable, "-u", bot_script],
                    cwd=os.getcwd(),
                    env=os.environ
                )
                print(f"[Launcher] Token Refresh Bot (re)spawned (PID: {bot_proc.pid}).")
            time.sleep(3)
        web_code = web_proc.wait()
        print(f"[Launcher] Web process exited with code {web_code}.")
    finally:
        if bot_proc and bot_proc.poll() is None:
            print("[Launcher] Terminating background Token Refresh Bot...")
            bot_proc.terminate()


if __name__ == "__main__":
    main()
