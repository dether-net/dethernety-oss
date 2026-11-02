#!/usr/bin/env python3
"""Run a command for the byodt tests, with or without a terminal, and never let it hang.

  tty-driver.py tty   TIMEOUT EXPECT ANSWER [EXPECT ANSWER ...] -- COMMAND [ARGS ...]
      Runs COMMAND on a new pseudo-terminal. For each pair, waits until EXPECT has appeared in the output since the
      previous answer, then types ANSWER and a newline. Prints everything COMMAND wrote.

  tty-driver.py notty TIMEOUT -- COMMAND [ARGS ...]
      Runs COMMAND in a new session, so it has no controlling terminal, with stdin a pipe that is never written to or
      closed: a read that would wait for input waits until the timeout, instead of seeing an immediate end of input.

Either way the exit status is COMMAND's, or 124 when it ran past TIMEOUT seconds (it is then killed).
"""
import os
import pty
import select
import signal
import subprocess
import sys
import time


def exit_code(status):
    if hasattr(os, "waitstatus_to_exitcode"):
        return os.waitstatus_to_exitcode(status)
    return (status >> 8) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)


def run_tty(timeout, pairs, cmd):
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execvp(cmd[0], cmd)
        finally:
            os._exit(127)
    out = b""
    consumed = 0  # output up to here has already been matched against a prompt
    deadline = time.monotonic() + timeout
    pending = list(pairs)
    status = None
    while True:
        if time.monotonic() > deadline:
            if status is None:
                os.kill(pid, signal.SIGKILL)
                os.waitpid(pid, 0)
            sys.stdout.write(out.decode(errors="replace") + "\n[tty-driver: timed out]\n")
            return 124
        ready, _, _ = select.select([fd], [], [], 0.1)
        if ready:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                chunk = b""
            if not chunk:
                break
            out += chunk
        while pending and pending[0][0].encode() in out[consumed:]:
            expect, answer = pending.pop(0)
            consumed = out.index(expect.encode(), consumed) + len(expect)
            os.write(fd, answer.encode() + b"\n")
        if status is None:
            done, st = os.waitpid(pid, os.WNOHANG)
            if done:
                status = st
        if status is not None and not ready:
            break
    if status is None:
        _, status = os.waitpid(pid, 0)
    sys.stdout.write(out.decode(errors="replace"))
    return exit_code(status)


def run_notty(timeout, cmd):
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         start_new_session=True)
    out = b""
    deadline = time.monotonic() + timeout
    try:
        while True:
            if time.monotonic() > deadline:
                os.killpg(p.pid, signal.SIGKILL)
                p.wait()
                sys.stdout.write(out.decode(errors="replace") + "\n[tty-driver: timed out]\n")
                return 124
            ready, _, _ = select.select([p.stdout], [], [], 0.1)
            if ready:
                chunk = os.read(p.stdout.fileno(), 4096)
                if not chunk:
                    break
                out += chunk
        p.wait()
        sys.stdout.write(out.decode(errors="replace"))
        return p.returncode
    finally:
        p.stdin.close()


def main(argv):
    try:
        sep = argv.index("--")
        mode, timeout, rest, cmd = argv[1], float(argv[2]), argv[3:sep], argv[sep + 1:]
    except (ValueError, IndexError):
        sys.stderr.write(__doc__)
        return 2
    if not cmd:
        sys.stderr.write(__doc__)
        return 2
    if mode == "tty":
        if len(rest) % 2:
            sys.stderr.write("tty-driver: EXPECT and ANSWER come in pairs\n")
            return 2
        return run_tty(timeout, list(zip(rest[0::2], rest[1::2])), cmd)
    if mode == "notty":
        return run_notty(timeout, cmd)
    sys.stderr.write(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
