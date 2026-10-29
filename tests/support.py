"""Shared paths and isolated, headless Playwright browser configuration.

ATLAS_CHROME_BIN explicitly selects a Chromium-compatible executable. Without
it, use an installed macOS Google Chrome, or Playwright's bundled Chromium.
A bad explicit path is deliberately not hidden by a fallback or a test skip.
"""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results'


def chrome_executable() -> str | None:
    override = os.environ.get('ATLAS_CHROME_BIN')
    if override:
        return override
    chrome = Path('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    if sys.platform == 'darwin' and chrome.is_file():
        return str(chrome)
    return None


def enlarge_headless_window(context, page) -> None:
    """Fix native opaque-iframe hit testing without changing the CSS viewport.

    macOS headless Chrome can clip native OOPIF clicks at its outer window edge.
    Resize only this test-owned headless window, never a user's attached browser.
    """
    viewport = page.viewport_size
    session = context.new_cdp_session(page)
    try:
        window = session.send('Browser.getWindowForTarget')
        session.send('Browser.setWindowBounds', {
            'windowId': window['windowId'],
            'bounds': {
                'width': max(1640, viewport['width'] + 100),
                'height': max(1400, viewport['height'] + 240),
            },
        })
    finally:
        session.detach()
