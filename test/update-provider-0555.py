#!/usr/bin/env python3
"""Compatibility entry: the old Provider was removed in helper revision2."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name('update-session-r2.py')),run_name='__main__')
