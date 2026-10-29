"""Production timeline host integration; no duplicate module injection."""
import unittest
from playwright.sync_api import sync_playwright,expect
from scripts import build as builder
from tests.support import chrome_executable
class TimelineIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw=sync_playwright().start();cls.browser=cls.pw.chromium.launch(headless=True,executable_path=chrome_executable())
    @classmethod
    def tearDownClass(cls):cls.browser.close();cls.pw.stop()
    def setUp(self):
        self.context=self.browser.new_context(viewport={'width':1440,'height':960});self.addCleanup(self.context.close);self.page=self.context.new_page();self.errors=[];self.requests=[]
        self.context.route('**/*',lambda r:(self.requests.append(r.request.url),r.abort()))
        self.page.on('pageerror',lambda e:self.errors.append(str(e)))
        html=builder.build()
        self.page.set_content(html,wait_until='load');self.settle()
    def tearDown(self):
        self.assertEqual(self.errors,[]);self.assertEqual(self.requests,[]);self.context.close()
    def settle(self):self.page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    def test_each_timeline_person_has_direct_tree_and_profile_buttons(self):
        p=self.page;p.evaluate('familyAtlas.showTimeline()');self.settle()
        self.assertEqual(p.locator('#timeline-page [data-tl-tree]').count(),37)
        self.assertEqual(p.locator('#timeline-page [data-tl-profile]').count(),37)
        p.locator('[data-tl-tree="P-0011"]').click();self.settle()
        expect(p.locator('#timeline-page')).to_be_hidden()
        self.assertEqual(p.evaluate('familyAtlas.state.selected'),'P-0011')
        self.assertIsNone(p.evaluate('familyAtlas.state.locatedContext'))
        expect(p.locator('#drawer')).to_be_visible()
        self.assertGreater(p.evaluate('familyAtlas.treeState.scale'),0.5)
        p.evaluate('familyAtlas.showTimeline()');self.settle()
        p.locator('#tl-search').fill('Владимир Никонорович');self.settle()
        p.locator('[data-tl-tree="P-0024"]').click();self.settle()
        expect(p.locator('#timeline-page')).to_be_hidden()
        self.assertEqual(p.evaluate('familyAtlas.state.selected'),'P-0024')

    def test_mobile_direct_tree_button_and_candidate_identity(self):
        p=self.page;p.set_viewport_size({'width':390,'height':844});self.settle();p.evaluate('familyAtlas.showTimeline()');self.settle()
        p.locator('[data-tl-tree="P-0011"]').click();self.settle()
        expect(p.locator('#timeline-page')).to_be_hidden()
        self.assertEqual(p.evaluate('familyAtlas.state.selected'),'P-0011')
        p.evaluate('familyAtlas.showTimeline()');self.settle()
        p.locator('#tl-records').check();p.locator('#tl-search').fill('C-0011');self.settle()
        p.locator('[data-tl-tree="C-0011"]').click();self.settle()
        expect(p.locator('#timeline-page')).to_be_hidden()
        self.assertEqual(p.evaluate('familyAtlas.state.selected'),'C-0011')
        self.assertEqual(p.locator('[data-person-detail]').get_attribute('data-person-detail'),'C-0011')
        self.assertEqual(p.evaluate('familyAtlas.state.locatedContext'),'P-0011')

    def test_separate_page_navigation_and_camera(self):
        p=self.page;self.assertEqual(p.evaluate('typeof familyAtlas.showTimeline'),'function')
        p.evaluate('familyAtlas.focusFamily("F-home")');self.settle();old=p.evaluate('({...familyAtlas.treeState})')
        p.get_by_role('button',name='Таймлайн',exact=True).click();self.settle()
        expect(p.locator('#timeline-page')).to_be_visible();self.assertEqual(p.locator('#timeline-page [data-tl-person]').count(),37)
        p.get_by_role('button',name='К дереву',exact=True).click();self.settle()
        expect(p.locator('#timeline-page')).to_be_hidden();new=p.evaluate('({...familyAtlas.treeState})')
        for k in ['scale','cx','cy']:self.assertAlmostEqual(old[k],new[k])
    def test_timeline_dossier_is_visible_and_locate_restores_tree(self):
        p=self.page;p.evaluate('familyAtlas.showTimeline()');self.settle()
        p.locator('#timeline-page [data-tl-person="P-0011"]').click();self.settle()
        expect(p.locator('#drawer')).to_be_visible();expect(p.locator('#dossier')).to_contain_text('Емельян')
        self.assertLess(p.locator('#drawer').bounding_box()['x'],1440)
        p.locator('[data-action="locate"]').click();self.settle();expect(p.locator('#timeline-page')).to_be_hidden()
        self.assertEqual(p.evaluate('familyAtlas.state.selected'),'P-0011')
    def test_mobile_timeline_dossier_and_return(self):
        p=self.page;p.set_viewport_size({'width':390,'height':844});self.settle();p.evaluate('familyAtlas.showTimeline()');self.settle()
        self.assertLessEqual(p.evaluate('document.documentElement.scrollWidth'),390)
        p.locator('#timeline-page [data-tl-person="P-0011"]').click();self.settle();expect(p.locator('#drawer')).to_be_visible()
        r=p.locator('#drawer').bounding_box();self.assertLessEqual(r['x']+r['width'],391)
        p.locator('[data-action="close"]').click();self.settle();expect(p.locator('#timeline-page')).to_be_visible()
        p.get_by_role('button',name='К дереву',exact=True).click();expect(p.locator('#timeline-page')).to_be_hidden()
if __name__=='__main__':unittest.main()
