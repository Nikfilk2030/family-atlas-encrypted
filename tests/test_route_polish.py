"""The reported U shape was two occluded edges, not a single A* loop."""
import unittest
from playwright.sync_api import sync_playwright
from scripts import build
from tests.support import RESULTS, chrome_executable
QA = RESULTS / 'route-polish'
class RoutePolishTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.pw=sync_playwright().start();cls.browser=cls.pw.chromium.launch(headless=True,executable_path=chrome_executable());QA.mkdir(parents=True, exist_ok=True)
 @classmethod
 def tearDownClass(cls):cls.browser.close();cls.pw.stop()
 def setUp(self):
  self.c=self.browser.new_context(viewport={'width':1440,'height':960});self.addCleanup(self.c.close);self.p=self.c.new_page();self.errors=[];self.requests=[];self.p.on('pageerror',lambda e:self.errors.append(str(e)));self.c.route('**/*',lambda r:(self.requests.append(r.request.url),r.abort()));self.p.set_content(build.build());self.p.wait_for_function('familyAtlas.treeState.initialized')
 def tearDown(self):self.assertEqual(self.errors,[]);self.assertEqual(self.requests,[]);self.c.close()
 def frame(self,scale=.4):self.p.evaluate('s=>{const b=familyAtlas.boxes.get("F-maternal");familyAtlas.commit(s,b.x+b.w/2,b.y+b.h/2,"manual")}',scale)
 def test_routes_avoid_the_ACTUAL_opaque_summaries_in_both_projections(self):
  for mode in ['generations','years']:
   self.p.evaluate('m=>familyAtlas.setLayoutMode(m)',mode)
   for s in [.1,.28,.4,.579]:
    self.frame(s)
    hits=self.p.evaluate('''()=>{const r=[...document.querySelectorAll('.overview-label')].map(n=>({id:n.dataset.openFamily,r:n.getBoundingClientRect()})),hits=[];for(const path of document.querySelectorAll('[data-family-edge]')){const m=path.getScreenCTM(),len=path.getTotalLength();if(!len){hits.push({edge:path.dataset.familyEdge,empty:true});continue;}for(let t=1;t<len-1;t+=12){const p=path.getPointAtLength(t),q=new DOMPoint(p.x,p.y).matrixTransform(m);for(const b of r)if(q.x>b.r.left+1&&q.x<b.r.right-1&&q.y>b.r.top+1&&q.y<b.r.bottom-1){hits.push({edge:path.dataset.familyEdge,inside:b.id});break;}}}return hits.slice(0,12)}''')
    self.assertEqual(hits,[],(mode,s,hits))
  self.p.screenshot(path=str(QA/'years-mid.png'))
 def test_large_summaries_have_real_information_without_empty_slabs(self):
  for s in [.095,.1,.28,.32,.4,.404,.41,.579]:
   self.frame(s)
   bad=self.p.locator('.overview-label').evaluate_all('''ns=>ns.filter(n=>{const r=n.getBoundingClientRect();return r.width>300&&r.height>160&&getComputedStyle(n.querySelector('.family-names')).display==='none'}).map(n=>n.dataset.openFamily)''')
   self.assertEqual(bad,[],s)
  self.frame(.4);self.p.screenshot(path=str(QA/'midzoom.png'))
 def test_clear_local_connection_uses_a_smooth_curve(self):
  path=self.p.evaluate('''()=>atlasRouter.overviewRoutes(new Map([['a',{x:0,y:0,w:280,h:100}],['b',{x:180,y:400,w:280,h:100}]]),[{from:'a',to:'b',through_person_id:'fixture'}]).get('a:b')''')
  self.assertIn('C',path,'A clear local connection should be one smooth curve, not an electrical elbow')
 def test_parent_families_are_aligned_by_generation_from_home(self):
  self.frame(.36)
  levels=self.p.evaluate('()=>Object.fromEntries([...familyAtlas.boxes].map(([id,b])=>[id,b.y]))')
  self.assertEqual(levels['F-maternal'],levels['F-paternal'],'Parents of the same home family belong on one generation level, not one above another')
  self.assertEqual(levels['F-erchenko'],levels['F-sorokin'],'Grandparent families must align even when one has more known ancestors')
 def test_incoming_continuations_have_distinct_normal_ports(self):
  self.frame(.4)
  ports=self.p.evaluate('''()=>[...document.querySelectorAll('[data-family-edge]')].map(p=>{const len=p.getTotalLength(),a=p.getPointAtLength(len),b=p.getPointAtLength(len-.01),c=p.getPointAtLength(0),d=p.getPointAtLength(.01);return {key:p.dataset.familyEdge,target:p.dataset.familyEdge.split(':')[1],a:{x:a.x,y:a.y},b:{x:b.x,y:b.y},c:{x:c.x,y:c.y},d:{x:d.x,y:d.y}}})''')
  for item in ports:
   self.assertAlmostEqual(item['a']['x'],item['b']['x'],places=3,msg=item)
   self.assertLess(item['b']['y'],item['a']['y'],item)
   self.assertAlmostEqual(item['c']['x'],item['d']['x'],places=3)
   self.assertGreater(item['d']['y'],item['c']['y'],item)
  for x in ports:
   for y in ports:
    if x['key']!=y['key'] and x['target']==y['target']:self.assertNotEqual(x['a'],y['a'])
if __name__=='__main__':unittest.main()
