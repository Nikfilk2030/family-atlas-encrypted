"""Every visible cross-family line is a real mouse/touch/keyboard target."""
import unittest
from playwright.sync_api import sync_playwright,expect
from scripts import build
from tests.support import RESULTS, chrome_executable
QA = RESULTS / 'line-interactions'
class LineInteractionTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.pw=sync_playwright().start();cls.b=cls.pw.chromium.launch(headless=True,executable_path=chrome_executable());QA.mkdir(parents=True, exist_ok=True)
 @classmethod
 def tearDownClass(cls):cls.b.close();cls.pw.stop()
 def open(self,touch=False):
  self.c=self.b.new_context(viewport={'width':1490,'height':900},device_scale_factor=2,has_touch=touch);self.addCleanup(self.c.close);self.p=self.c.new_page();self.errors=[];self.requests=[];self.p.on('pageerror',lambda e:self.errors.append(str(e)));self.c.route('**/*',lambda r:(self.requests.append(r.request.url),r.abort()));self.p.set_content(build.build());self.p.wait_for_function('familyAtlas.treeState.initialized')
 def tearDown(self):self.assertEqual(self.errors,[]);self.assertEqual(self.requests,[]);self.c.close()
 def locate(self,mode='generations',detail=False):
  self.p.evaluate('m=>familyAtlas.setLayoutMode(m)',mode)
  self.p.evaluate('detail=>{const b=familyAtlas.boxes.get("F-maternal");familyAtlas.commit(detail?.8:.36,b.x+b.w/2,b.y+b.h/2,"manual")}',detail)
  selector='[data-continuation-hit="F-sorokin:F-maternal"][data-hit-layer="'+('detail' if detail else 'overview')+'"]'
  hit=self.p.locator(selector);self.assertEqual(hit.count(),1,'The visible family line has no interaction region')
  # Find a real exposed point, excluding cards and other overlapping hit regions.
  search='''n=>{const len=n.getTotalLength(),m=n.getScreenCTM();for(let f=.02;f<.99;f+=.01){const z=n.getPointAtLength(len*f),p=new DOMPoint(z.x,z.y).matrixTransform(m),at=document.elementFromPoint(p.x,p.y);if(p.x>30&&p.x<innerWidth-90&&p.y>240&&p.y<innerHeight-130&&at?.hasAttribute('data-continuation-hit'))return{x:p.x,y:p.y}}return null}'''
  point=hit.evaluate(search)
  if point is None:
   hit.evaluate('n=>{const z=n.getPointAtLength(n.getTotalLength()/2);familyAtlas.commit(familyAtlas.treeState.scale,z.x,z.y,"manual")}');point=hit.evaluate(search)
  self.assertIsNotNone(point,'No native hit-testable segment after bringing the line into view');return hit,point
 def choose_if_needed(self):
  if self.p.locator('[data-continuation-choices]').count():
   choice=self.p.locator('[data-choose-continuation="F-sorokin:F-maternal"]');expect(choice).to_be_visible();choice.click()
 def test_native_mouse_line_opens_named_relationship_and_sources(self):
  self.open();hit,p=self.locate();self.p.mouse.move(p['x'],p['y']);self.p.mouse.click(p['x'],p['y']);self.choose_if_needed();expect(self.p.locator('[data-continuation-detail="F-sorokin:F-maternal"]')).to_be_visible();expect(self.p.locator('#dossier')).to_contain_text('Сорокин Владимир Алексеевич');expect(self.p.locator('#dossier')).to_contain_text('Сорокины и Попонниковы');expect(self.p.locator('#dossier')).to_contain_text('Сорокины и Ерченко');self.assertGreater(self.p.locator('#dossier [data-source-id]').count(),0);self.p.screenshot(path=str(QA/'mouse-line-details.png'))
 def test_keyboard_and_touch_reach_same_line(self):
  self.open(True);hit,p=self.locate();self.assertEqual(hit.evaluate('n=>getComputedStyle(n).webkitTapHighlightColor'),'rgba(0, 0, 0, 0)','Native SVG tap highlight must not fill the entire route bounding box');self.p.touchscreen.tap(p['x'],p['y']);self.choose_if_needed();expect(self.p.locator('[data-continuation-detail]')).to_be_visible();self.p.evaluate('familyAtlas.closeDrawer()');hit,p=self.locate();hit.focus();hit.press('Enter');expect(self.p.locator('[data-continuation-detail]')).to_be_visible()
 def test_chronological_line_and_line_drag_are_real_native_interactions(self):
  self.open();hit,p=self.locate(mode='years');self.p.mouse.click(p['x'],p['y']);self.choose_if_needed();expect(self.p.locator('[data-continuation-detail="F-sorokin:F-maternal"]')).to_be_visible();self.p.evaluate('familyAtlas.closeDrawer()')
  hit,p=self.locate();before=self.p.evaluate('({...familyAtlas.treeState})');self.p.mouse.move(p['x'],p['y']);self.p.mouse.down();self.p.mouse.move(p['x']+65,p['y']+25,steps=8);self.p.mouse.up();after=self.p.evaluate('({...familyAtlas.treeState})');self.assertNotEqual(before['cx'],after['cx']);self.assertEqual(self.p.locator('#drawer:visible').count(),0)
 def test_identity_line_at_detail_is_clickable_too(self):
  self.open();hit,p=self.locate(detail=True);self.p.mouse.click(p['x'],p['y']);self.choose_if_needed();expect(self.p.locator('[data-continuation-detail="F-sorokin:F-maternal"]')).to_be_visible()
if __name__=='__main__':unittest.main()
