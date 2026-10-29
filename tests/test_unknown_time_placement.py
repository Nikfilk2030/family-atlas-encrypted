"""User-approved display-only time hints: unknown births stay with their families."""
import json,unittest
from playwright.sync_api import sync_playwright
from scripts import build
from tests.support import RESULTS, chrome_executable
QA = RESULTS / 'unknown-time'
class UnknownTimeTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.pw=sync_playwright().start();cls.b=cls.pw.chromium.launch(headless=True,executable_path=chrome_executable());QA.mkdir(parents=True, exist_ok=True)
 @classmethod
 def tearDownClass(cls):cls.b.close();cls.pw.stop()
 def setUp(self):
  self.c=self.b.new_context(viewport={'width':1490,'height':900},device_scale_factor=2);self.addCleanup(self.c.close);self.p=self.c.new_page();self.errors=[];self.requests=[];self.c.route('**/*',lambda r:(self.requests.append(r.request.url),r.abort()));self.p.on('pageerror',lambda e:self.errors.append(str(e)));self.p.set_content(build.build());self.p.wait_for_function('familyAtlas.treeState.initialized')
 def tearDown(self):self.assertEqual(self.errors,[]);self.assertEqual(self.requests,[]);self.c.close()
 def test_undated_zoya_family_stays_with_its_generation_not_after_2000(self):
  self.p.evaluate('familyAtlas.setLayoutMode("years")')
  pts=self.p.evaluate('''()=>[...familyAtlas.occurrences.values()].filter(o=>o.family==='F-zoya').map(o=>({id:o.id,y:o.y+o.h/2,limit:familyAtlas.graphTime.yearY(1980)}))''')
  self.assertEqual(len(pts),5)
  self.assertTrue(all(x['y']<x['limit'] for x in pts),'Undated Zoya family is still exiled after the known20th-century families')
 def test_estimates_are_explicitly_conditional_and_do_not_change_births(self):
  before=self.p.evaluate('JSON.stringify(familyAtlas.model)');self.p.evaluate('familyAtlas.setLayoutMode("years")')
  self.assertEqual(self.p.evaluate('JSON.stringify(familyAtlas.model)'),before)
  self.assertEqual(self.p.locator('.undated-guide,.undated-axis-note,.time-undated').count(),0)
  self.p.evaluate('familyAtlas.showPerson("P-0034",false);familyAtlas.locatePerson("P-0034")')
  card=self.p.locator('[data-family="F-efim-maria"] [data-person-node="P-0034"]');self.assertIn('Дата рождения неизвестна',card.inner_text());self.assertIn('условно',card.inner_text().lower())
  o=self.p.evaluate('familyAtlas.occurrences.get("F-efim-maria:P-0034")');self.assertEqual(o['temporal']['kind'],'unknown');self.assertIsNone(o['temporal']['year']);self.assertIsNotNone(o['temporal']['placementYear'])
  self.assertFalse(self.p.evaluate('familyAtlas.model.people.find(p=>p.id==="P-0034").birth'))
 def test_real_births_keep_exact_axis_alignment_and_context_families_remain_local(self):
  self.p.evaluate('familyAtlas.setLayoutMode("years")')
  bad=self.p.evaluate('''()=>[...familyAtlas.occurrences.values()].filter(o=>o.temporal.kind!=='unknown'&&Math.abs(o.y+o.h/2-familyAtlas.graphTime.yearY(o.temporal.year))>.01).map(o=>o.id)''');self.assertEqual(bad,[])
  for fid in ['F-zoya','F-stepan-younger','F-hyp-danila','F-hyp-roman-parents']:
   summary=self.p.locator('.overview-label[data-open-family="'+fid+'"]');self.assertIn('неизвест',summary.inner_text().lower());self.assertIn('ориентир',summary.inner_text().lower())
  self.p.evaluate('familyAtlas.fitTree()');self.p.screenshot(path=str(QA/'overview-desktop.png'))
if __name__=='__main__':unittest.main()
