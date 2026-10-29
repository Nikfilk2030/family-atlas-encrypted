"""Browser-harness portability without launching or changing a user's browser."""
import os
import unittest
from unittest.mock import Mock, patch

from tests import support


class SupportTests(unittest.TestCase):
    def test_explicit_browser_path_wins_without_silent_fallback(self):
        with patch.dict(os.environ, {'ATLAS_CHROME_BIN': '/chosen/chromium'}, clear=True):
            self.assertEqual(support.chrome_executable(), '/chosen/chromium')

    def test_installed_macos_chrome_is_selected(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(support.sys, 'platform', 'darwin'):
            with patch.object(support.Path, 'is_file', return_value=True):
                self.assertEqual(
                    support.chrome_executable(),
                    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                )

    def test_missing_macos_chrome_uses_playwright_bundled_chromium(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(support.sys, 'platform', 'darwin'):
            with patch.object(support.Path, 'is_file', return_value=False):
                self.assertIsNone(support.chrome_executable())

    def test_linux_uses_playwright_bundled_chromium(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(support.sys, 'platform', 'linux'):
            with patch.object(support.Path, 'is_file', return_value=True):
                self.assertIsNone(support.chrome_executable())

    def test_empty_override_uses_normal_browser_discovery(self):
        with patch.dict(os.environ, {'ATLAS_CHROME_BIN': ''}, clear=True):
            with patch.object(support.sys, 'platform', 'linux'):
                self.assertIsNone(support.chrome_executable())

    def test_outer_window_enlarges_without_changing_css_viewport(self):
        context = Mock()
        page = Mock(viewport_size={'width': 2452, 'height': 1666})
        session = context.new_cdp_session.return_value
        session.send.return_value = {'windowId': 7}
        support.enlarge_headless_window(context=context, page=page)
        session.send.assert_any_call('Browser.getWindowForTarget')
        session.send.assert_any_call(
            'Browser.setWindowBounds',
            {'windowId': 7, 'bounds': {'width': 2552, 'height': 1906}},
        )
        page.set_viewport_size.assert_not_called()
        session.detach.assert_called_once_with()

    def test_evidence_lives_outside_sources_and_data(self):
        self.assertEqual(support.RESULTS, support.ROOT / 'test-results')


if __name__ == '__main__':
    unittest.main(verbosity=2)
