"""Birth timeline acceptance against the actual in-memory standalone build.

Run from the repository root: python -m unittest tests.test_timeline -v
No JS/CSS copies are appended: the public builder must include the real modules.
Tests use an opaque allow-scripts Blob iframe and abort all network requests.
Evidence is written only under test-results/timeline/.
"""
import json
import unittest
from playwright.sync_api import sync_playwright
from scripts import build as builder
from tests.support import RESULTS, chrome_executable, enlarge_headless_window

QA = RESULTS / 'timeline'


class TimelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        QA.mkdir(parents=True, exist_ok=True)
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(
            executable_path=chrome_executable(),
            headless=True)
        cls.evidence = []
        cls.errors = []
        cls.requests = []

    @classmethod
    def tearDownClass(cls):
        QA.mkdir(parents=True, exist_ok=True)
        # Keep per-check evidence here; the runner owns suite-wide pass/fail totals.
        (QA / 'results.json').write_text(json.dumps({
            'chrome': cls.browser.version, 'checks': cls.evidence,
            'javascriptErrors': cls.errors, 'networkRequests': cls.requests,
            'sandbox': 'allow-scripts', 'existingBuildOverwritten': False,
        }, ensure_ascii=False, indent=2), encoding='utf-8')
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.js_errors = []
        self.network = []
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 960})
        self.addCleanup(self.context.close)
        self.context.route('**/*', lambda r: (self.network.append(r.request.url), r.abort()))
        self.page = self.context.new_page()
        # macOS headless Chrome's outer window clips native OOPIF hit testing near
        # its bottom edge even with a valid CSS viewport. Keep only that isolated
        # outer window larger; NEVER replace native clicks with JS click().
        enlarge_headless_window(context=self.context, page=self.page)
        self.page.on('pageerror', lambda e: self.js_errors.append(str(e)))
        self.page.set_content('<style>html,body{margin:0;height:100%}iframe{display:block;border:0;width:100%;height:100%}</style>')
        with self.page.expect_event('framenavigated', predicate=lambda f: f.url.startswith('blob:')) as loaded:
            self.page.evaluate('html => {const f=document.createElement("iframe");f.sandbox="allow-scripts";f.src=URL.createObjectURL(new Blob([html],{type:"text/html"}));document.body.append(f)}', builder.build())
        self.f = loaded.value
        self.f.wait_for_load_state()
        self.settle()

    def tearDown(self):
        self.errors.extend(self.js_errors)
        self.requests.extend(self.network)
        try:
            self.assertEqual(self.js_errors, [])
            self.assertEqual(self.network, [])
        finally:
            self.context.close()

    def settle(self):
        self.f.evaluate('() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')

    def viewport(self, width, height):
        self.page.set_viewport_size({'width': width, 'height': height})
        enlarge_headless_window(context=self.context, page=self.page)
        self.settle()

    def require_module(self):
        self.assertTrue(self.f.evaluate('typeof window.familyTimeline === "object"'),
                        'Separate birth timeline module is missing')

    def test_01_exact_birth_and_year_preserve_original_precision(self):
        self.require_module()
        result = self.f.evaluate('''() => ['23.08.1909','1932'].map(s=>familyTimeline.parseBirth(s))''')
        self.assertEqual(result[0]['raw'], '23.08.1909')
        self.assertEqual(result[0]['kind'], 'exact')
        self.assertEqual([result[0][k] for k in ['year', 'month', 'day']], [1909, 8, 23])
        self.assertEqual(result[1]['kind'], 'year')
        self.assertEqual(result[1]['year'], 1932)
        self.assertIsNone(result[1]['month'])
        self.assertIsNone(result[1]['day'])
        self.evidence.append({'test': self._testMethodName, 'status': 'passed'})
    def test_02_uncertainty_ranges_decades_and_invalid_births(self):
        self.require_module()
        cases = ['около1923', '~ 1923', 'around 1923', '1930–1933?',
                 '1960–1970-е? (общая оценка)', '1960-е',
                 '10.12.1932 (все даты по словам пользователя примерные)',
                 '31.02.1909', '29.02.1900', '29.02.2000', '1935-1930',
                 'ум. около 1999', '', None, 'рождение не установлено']
        results = self.f.evaluate('xs=>xs.map(x=>familyTimeline.parseBirth(x))', cases)
        for n in [0, 1, 2, 6]:
            self.assertEqual(results[n]['kind'], 'approximate', cases[n])
            self.assertTrue(results[n]['uncertain'])
            self.assertEqual(results[n]['raw'], cases[n])
        self.assertEqual(results[3]['kind'], 'range')
        self.assertEqual([results[3]['startYear'], results[3]['endYear']], [1930, 1933])
        self.assertIsNone(results[3]['year'], 'An interval is not one exact birth year')
        self.assertEqual(results[4]['kind'], 'decade')
        self.assertEqual([results[4]['startYear'], results[4]['endYear']], [1960, 1979])
        self.assertIsNone(results[4]['year'])
        self.assertEqual([results[5]['startYear'], results[5]['endYear']], [1960, 1969])
        self.assertEqual(results[9]['kind'], 'exact')
        for n in [7, 8, 10, 11, 12, 13, 14]:
            self.assertEqual(results[n]['kind'], 'unknown', cases[n])
            self.assertIsNone(results[n]['startYear'])
        self.evidence.append({'test': self._testMethodName, 'status': 'passed', 'cases': len(cases)})
    def open_timeline(self):
        self.require_module()
        self.assertTrue(self.f.evaluate('typeof familyTimeline.show === "function"'),
                        'Timeline page show() is missing')
        self.f.evaluate('''() => {
          const b=document.createElement('button');b.id='qa-timeline-open';b.textContent='Хронология';
          document.querySelector('.masthead nav').append(b);
          window.qaTimelineOpened=[]; window.qaTimelineBack=0;
          const restore=()=>{document.querySelector('#workspace').append(document.querySelector('#drawer'));document.querySelector('#workspace').hidden=false;};
          b.addEventListener('click',()=>{
            familyAtlas.closeDrawer();document.querySelector('#workspace').hidden=true;
            familyTimeline.show({
              onOpenPerson:(id,options)=>{
                qaTimelineOpened.push({id,options});
                familyTimeline.element.append(document.querySelector('#drawer'));
                familyAtlas.showPerson(id,false);
              },
              onBack:()=>{qaTimelineBack++;restore();familyAtlas.closeDrawer();}
            });
          });
          document.addEventListener('click',e=>{
            if(e.target.closest('[data-action="locate"]')&&familyTimeline.visible){
              familyTimeline.hide({restoreFocus:false});restore();
            }
          },true);
        }''')
        # Open by a native control even when the original nav is hidden on mobile.
        self.f.locator('#qa-timeline-open').click()
        self.settle()

    def test_03_real_family_births_stack_chronologically_unknowns_are_not_deaths(self):
        self.open_timeline()
        f = self.f
        self.assertTrue(f.locator('#timeline-page').is_visible())
        self.assertEqual(f.locator('#timeline-page h1').inner_text(), 'Когда родились')
        actual = f.locator('[data-tl-entry]').evaluate_all('ns=>ns.map(n=>n.dataset.tlEntry)')
        expected = f.evaluate('familyAtlas.model.people.filter(p=>p.kind==="family").map(p=>p.id)')
        self.assertEqual(sorted(actual), sorted(expected))
        self.assertEqual(len(actual), len(set(actual)), 'One ID must produce exactly one birth entry')
        known = f.locator('[data-tl-birth]').evaluate_all('ns=>ns.map(n=>({id:n.dataset.tlEntry,start:+n.dataset.tlBirth}))')
        self.assertEqual([e['start'] for e in known], sorted(e['start'] for e in known))
        self.assertEqual(len(known), 21)
        for pid in ['P-0024', 'P-0025']:
            self.assertEqual(f.locator('#tl-unknown [data-tl-entry="'+pid+'"]').count(), 1)
            self.assertEqual(f.locator('[data-tl-birth][data-tl-entry="'+pid+'"]').count(), 0)
        exact = f.locator('[data-tl-entry="P-0011"]')
        self.assertEqual(exact.get_attribute('data-tl-certainty'), 'exact')
        self.assertIn('23.08.1909', exact.inner_text())
        self.assertNotIn('04.01.1979', exact.inner_text())
        self.assertIn('Новосибирская область, село Татарка', exact.inner_text())
        self.assertIn('Дедушка Людмилы', exact.inner_text())
        self.assertEqual(f.locator('[data-tl-entry="P-0015"]').get_attribute('data-tl-certainty'), 'approximate')
        self.assertEqual(f.locator('[data-tl-entry="P-0006"]').get_attribute('data-tl-certainty'), 'decade')
        self.assertEqual(f.locator('[data-tl-entry="P-0036"]').locator('..').get_attribute('data-tl-stack'), '1911')
        self.assertEqual(f.locator('[data-tl-stack="1911"] [data-tl-entry]').count(), 2)
        f.locator('[data-tl-jump="unknown"]').click()
        self.assertTrue(f.locator('#tl-unknown-list').get_attribute('open') is not None)
        self.assertTrue(f.locator('[data-tl-entry="P-0024"] [data-tl-person]').is_visible())
        self.assertIn('Даты смерти', f.locator('#tl-unknown').inner_text())
        self.assertEqual(f.locator('#tl-axis [data-tl-entry][data-tl-kind="record"]').count(), 0)
        self.evidence.append({'test': self._testMethodName, 'status': 'passed',
                              'familyEntries': len(actual), 'datedBirths': len(known), 'unknown': len(actual)-len(known)})
    def test_04_native_search_branch_membership_and_empty_reset(self):
        self.open_timeline()
        f = self.f
        self.assertEqual(f.locator('#tl-search').count(), 1, 'Timeline needs its own searchable birth catalogue')
        original = f.evaluate('JSON.stringify(familyAtlas.model)')
        for branch in ['maternal', 'paternal', 'all']:
            f.locator('[data-tl-branch="'+branch+'"]').click()
            expected = f.evaluate('''branch=>familyAtlas.model.people.filter(p=>p.kind==='family'&&(branch==='all'||familyAtlas.model.families.some(f=>f.branch===branch&&[...f.parents,...f.children,...f.peers,...f.related.map(r=>r.person_id)].includes(p.id)))).map(p=>p.id).sort()''', branch)
            actual = f.locator('[data-tl-entry]').evaluate_all('ns=>ns.map(n=>n.dataset.tlEntry).sort()')
            self.assertEqual(actual, expected, branch)
            self.assertEqual(f.locator('[data-tl-branch="'+branch+'"]').get_attribute('aria-pressed'), 'true')
        search = f.locator('#tl-search')
        search.fill('тАТАРКА')
        self.assertEqual(f.locator('[data-tl-entry]').evaluate_all('ns=>ns.map(n=>n.dataset.tlEntry)'), ['P-0011'])
        search.fill('23.08.1909')
        self.assertEqual(f.locator('[data-tl-entry]').count(), 1)
        search.fill('P-0024')
        self.assertEqual(f.locator('#tl-unknown [data-tl-entry]').count(), 1)
        self.assertTrue(f.locator('[data-tl-person="P-0024"]').is_visible())
        search.fill('несуществующее имя 000')
        self.assertEqual(f.locator('[data-tl-entry]').count(), 0)
        self.assertIn('Ничего не найдено', f.locator('#tl-empty').inner_text())
        f.locator('[data-tl-reset]').click()
        self.assertEqual(search.input_value(), '')
        self.assertEqual(f.locator('[data-tl-entry]').count(), 37)
        self.assertEqual(f.evaluate('familyTimeline.getState().branch'), 'all')
        self.assertEqual(f.evaluate('JSON.stringify(familyAtlas.model)'), original)
        self.evidence.append({'test': self._testMethodName, 'status': 'passed', 'modelUnchanged': True})
    def test_05_record_toggle_keeps_candidates_distinct_and_sources_owned(self):
        self.open_timeline()
        f = self.f
        self.assertEqual(f.locator('#tl-records').count(), 1, 'Research records need a labelled opt-in toggle')
        self.assertFalse(f.locator('#tl-records').is_checked())
        self.assertIn('Отдельные записи-кандидаты', f.locator('label[for="tl-records"]').inner_text())
        f.locator('label[for="tl-records"]').click()
        self.assertTrue(f.locator('#tl-records').is_checked())
        self.assertEqual(f.locator('[data-tl-entry]').count(), 89)
        self.assertEqual(f.locator('[data-tl-kind="record"]').count(), 52)
        for branch in ['maternal', 'paternal']:
            f.locator('[data-tl-branch="'+branch+'"]').click()
            expected = f.evaluate('''branch=>familyAtlas.model.people.filter(p=>familyAtlas.model.families.some(f=>f.branch===branch&&[...f.parents,...f.children,...f.peers,...f.related.map(r=>r.person_id)].includes(p.id))).map(p=>p.id).sort()''', branch)
            self.assertEqual(f.locator('[data-tl-entry]').evaluate_all('ns=>ns.map(n=>n.dataset.tlEntry).sort()'), expected)
        f.locator('[data-tl-branch="all"]').click()
        f.locator('#tl-search').fill('Зайцев Емельян Аверьянович')
        family = f.locator('[data-tl-entry="P-0011"]')
        candidate = f.locator('[data-tl-entry="C-0011"]')
        self.assertEqual(family.count(), 1)
        self.assertEqual(candidate.count(), 1)
        self.assertIn('23.08.1909', family.inner_text())
        self.assertEqual(candidate.locator('.tl-birth-raw').inner_text(), '1909')
        self.assertIn('Тождество родственнику не установлено', candidate.inner_text())
        self.assertEqual(family.locator('[data-tl-source]').evaluate_all('ns=>ns.map(n=>n.dataset.tlSource)'), ['A-0008', 'A-0030'])
        self.assertEqual(candidate.locator('[data-tl-source]').evaluate_all('ns=>ns.map(n=>n.dataset.tlSource)'), ['A-0022', 'A-0023'])
        self.page.screenshot(path=str(QA / 'desktop-candidate-separation.png'))
        family.locator('.tl-provenance>summary').click()
        self.assertIn('Отдельная атрибуция даты рождения в модели не задана', family.inner_text())
        self.assertNotIn('Донесение', family.inner_text())
        self.evidence.append({'test': self._testMethodName, 'status': 'passed', 'allRecords': f.evaluate('familyAtlas.model.people.length'),
                              'separateCandidates': f.evaluate('familyAtlas.model.people.filter(p=>p.kind==="record").length')})
    def test_06_native_person_keyboard_back_and_locate_keep_exact_identity_and_camera(self):
        f = self.f
        f.evaluate('familyAtlas.commit(.65, 123, -42, "manual")')
        self.settle()
        before = f.evaluate('({scale:familyAtlas.treeState.scale,cx:familyAtlas.treeState.cx,cy:familyAtlas.treeState.cy})')
        self.open_timeline()
        f.locator('#tl-search').fill('P-0011')
        person = f.locator('[data-tl-person="P-0011"]')
        person.focus()
        person.press('Enter')
        self.settle()
        self.assertEqual(f.evaluate('qaTimelineOpened.map(x=>x.id)'), ['P-0011'], 'Click must dispatch the exact person ID once')
        self.assertEqual(f.evaluate('qaTimelineOpened[0].options'), {'locate': False, 'origin': 'timeline'})
        self.assertTrue(f.locator('#drawer').is_visible())
        self.assertEqual(f.locator('#dossier [data-person-detail="P-0011"]').count(), 1)
        self.assertTrue(f.evaluate('familyTimeline.visible'))
        f.locator('[data-action="close"]').click()
        self.settle()
        self.assertEqual(f.evaluate('({scale:familyAtlas.treeState.scale,cx:familyAtlas.treeState.cx,cy:familyAtlas.treeState.cy})'), before)
        f.locator('[data-tl-back]').focus()
        f.locator('[data-tl-back]').press('Enter')
        self.settle()
        self.assertFalse(f.evaluate('familyTimeline.visible'))
        self.assertTrue(f.locator('#workspace').is_visible())
        self.assertEqual(f.evaluate('qaTimelineBack'), 1)
        self.assertEqual(f.evaluate('({scale:familyAtlas.treeState.scale,cx:familyAtlas.treeState.cx,cy:familyAtlas.treeState.cy})'), before)
        f.locator('#qa-timeline-open').click()
        self.assertEqual(f.locator('#tl-search').input_value(), 'P-0011')
        self.assertEqual(f.locator('#timeline-page').count(), 1)
        f.locator('#tl-search').fill('C-0011')
        f.locator('label[for="tl-records"]').click()
        f.locator('[data-tl-person="C-0011"]').click()
        self.assertEqual(f.evaluate('qaTimelineOpened.map(x=>x.id)'), ['P-0011', 'C-0011'])
        self.assertEqual(f.locator('#dossier [data-person-detail="C-0011"]').count(), 1)
        self.assertEqual(f.evaluate('familyAtlas.state.selected'), 'C-0011')
        f.locator('[data-action="locate"]').click()
        self.settle()
        self.assertFalse(f.evaluate('familyTimeline.visible'))
        self.assertTrue(f.locator('#map').is_visible())
        self.assertNotEqual(f.evaluate('({scale:familyAtlas.treeState.scale,cx:familyAtlas.treeState.cx,cy:familyAtlas.treeState.cy})'), before)
        self.evidence.append({'test': self._testMethodName, 'status': 'passed',
                              'dispatchedIDs': f.evaluate('qaTimelineOpened.map(x=>x.id)'), 'cameraRetainedOnBack': before})
    def test_07_explicit_birth_source_provenance_and_untrusted_text_are_not_guessed(self):
        self.open_timeline()
        f = self.f
        f.evaluate('''() => {
          const copy=JSON.parse(JSON.stringify(familyAtlas.model));
          const p=copy.people.find(p=>p.id==='P-0011');p.birth_source_id='A-0030';
          p.name='<img src=x onerror="window.qaInjected=true"> Зайцев';
          const deathOnly=copy.people.find(p=>p.id==='P-0024');
          deathOnly.birth='';deathOnly.dates='1900';deathOnly.death='около 1999';
          familyTimeline.show({model:copy});
        }''')
        entry = f.locator('[data-tl-entry="P-0011"]')
        self.assertEqual(entry.locator('[data-tl-source-scope="birth"]').count(), 1,
                         'An explicitly attributed birth must identify its own source')
        self.assertEqual(entry.locator('[data-tl-source]').evaluate_all('ns=>ns.map(n=>n.dataset.tlSource)'), ['A-0030'])
        self.assertEqual(entry.locator('img').count(), 0)
        self.assertFalse(f.evaluate('Boolean(window.qaInjected)'))
        self.assertIn('<img', entry.locator('[data-tl-person]').inner_text())
        self.assertEqual(f.locator('#tl-unknown [data-tl-entry="P-0024"]').count(), 1)
        self.assertEqual(f.locator('[data-tl-entry="P-0024"][data-tl-birth]').count(), 0)
        self.evidence.append({'test': self._testMethodName, 'status': 'passed', 'fixture': 'explicit birth attribution and escaped text on cloned real model'})
    def test_08_responsive_native_controls_and_local_screenshots(self):
        self.open_timeline()
        f = self.f
        samples = []
        for width, height in [(1440, 960), (390, 844), (320, 740), (844, 390)]:
            self.viewport(width, height)
            geometry = f.evaluate('''() => {
              const root=familyTimeline.element, scroll=root.querySelector('.tl-scroll');
              const bad=[...root.querySelectorAll('.tl-event,.tl-person,.tl-birth,.tl-heading-row,.tl-filters,.tl-records-row')]
                .filter(n=>n.checkVisibility()&&n.scrollWidth>n.clientWidth+1).map(n=>n.className);
              const small=[...root.querySelectorAll('button,summary,label[for="tl-records"],#tl-search')]
                .filter(n=>n.checkVisibility()&&(n.getBoundingClientRect().height<44||n.getBoundingClientRect().width<44))
                .map(n=>({name:n.textContent.trim(),rect:n.getBoundingClientRect().toJSON()}));
              const cards=[...root.querySelectorAll('[data-tl-birth]')].map(n=>n.getBoundingClientRect());
              const overlap=[];for(let i=0;i<cards.length-1;i++){if(cards[i].bottom>cards[i+1].top+.5)overlap.push(i)}
              return {documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
                viewport:[innerWidth,innerHeight],rootWidth:root.clientWidth,rootScrollWidth:root.scrollWidth,
                contentHeight:scroll.clientHeight,bad,small,overlap};
            }''')
            self.assertEqual(geometry['documentWidth'], width, geometry)
            self.assertEqual(geometry['documentHeight'], height, geometry)
            self.assertEqual(geometry['rootWidth'], geometry['rootScrollWidth'], geometry)
            self.assertEqual(geometry['bad'], [], geometry)
            self.assertEqual(geometry['small'], [], geometry)
            self.assertEqual(geometry['overlap'], [], geometry)
            self.assertGreaterEqual(geometry['contentHeight'], 180, 'A short viewport still needs a readable scrolling birth page')
            samples.append(geometry)
            if width in [1440, 390]:
                self.page.screenshot(path=str(QA / ('desktop-1440x960.png' if width == 1440 else 'mobile-390x844.png')))
        self.viewport(390, 844)
        f.locator('[data-tl-branch="paternal"]').click()
        f.locator('#tl-search').fill('Зыкин')
        f.locator('label[for="tl-records"]').click()
        f.locator('#tl-search').fill('P-0015')
        self.assertIn('все даты по словам пользователя примерные', f.locator('[data-tl-entry="P-0015"]').inner_text())
        self.page.screenshot(path=str(QA / 'mobile-approximate-births.png'))
        f.locator('#tl-search').fill('1960–1970')
        self.assertEqual(f.locator('[data-tl-certainty="decade"]').count(), 3)
        self.page.screenshot(path=str(QA / 'mobile-decade-period.png'))
        f.locator('#tl-search').fill('P-0024')
        f.locator('[data-tl-branch="all"]').click()
        self.assertTrue(f.locator('[data-tl-person="P-0024"]').is_visible())
        self.page.screenshot(path=str(QA / 'mobile-unknown-birth.png'))
        f.locator('[data-tl-person="P-0024"]').click()
        self.assertTrue(f.locator('#drawer').is_visible())
        self.assertEqual(f.locator('#dossier [data-person-detail="P-0024"]').count(), 1)
        f.locator('[data-action="close"]').click()
        f.locator('[data-tl-back]').click()
        self.assertTrue(f.locator('#workspace').is_visible())
        self.evidence.append({'test': self._testMethodName, 'status': 'passed', 'geometry': samples})
    def test_09_unknown_search_shows_whole_name_in_mobile_viewport(self):
        self.open_timeline()
        self.viewport(390, 844)
        f = self.f
        f.locator('#tl-search').fill('P-0024')
        bounds = f.evaluate('''() => {
          const name=document.querySelector('[data-tl-person="P-0024"]').getBoundingClientRect();
          const view=document.querySelector('.tl-scroll').getBoundingClientRect();
          return {name:name.toJSON(),view:view.toJSON()};
        }''')
        self.assertGreaterEqual(bounds['name']['top'], bounds['view']['top'])
        self.assertLessEqual(bounds['name']['bottom'], bounds['view']['bottom'],
                             'An unknown-birth search must reveal the whole name, not just introductory copy')
        self.page.screenshot(path=str(QA / 'mobile-unknown-birth.png'))
        self.evidence.append({'test': self._testMethodName, 'status': 'passed', 'geometry': bounds})
    def test_10_all_candidates_fit_short_and_medium_viewports(self):
        self.open_timeline()
        f = self.f
        f.locator('label[for="tl-records"]').click()
        samples = []
        for width, height in [(1440, 960), (844, 700), (600, 390), (390, 600)]:
            self.viewport(width, height)
            result = f.evaluate('''() => {
              const root=familyTimeline.element;
              const bad=[...root.querySelectorAll('.tl-heading-row,.tl-filters,.tl-records-row,.tl-event,.tl-person,.tl-birth')]
                .filter(n=>n.checkVisibility()&&n.scrollWidth>n.clientWidth+1).map(n=>n.className);
              return {width:innerWidth,height:innerHeight,rootWidth:root.clientWidth,scrollWidth:root.scrollWidth,bad};
            }''')
            self.assertEqual(result['bad'], [], result)
            self.assertEqual(result['rootWidth'], result['scrollWidth'], result)
            self.assertEqual(f.evaluate('document.documentElement.scrollWidth'), width)
            samples.append(result)
        # Native decade jumps must work when the entire short page is the scroller.
        f.locator('[data-tl-jump="unknown"]').click()
        self.assertTrue(f.locator('#tl-unknown-list').get_attribute('open') is not None)
        self.assertGreater(f.evaluate('familyTimeline.element.scrollTop'), 0)
        self.evidence.append({'test': self._testMethodName, 'status': 'passed', 'geometry': samples})
    def test_11_default_open_fallback_is_real_and_opaque_sandbox_stays_unchanged(self):
        self.open_timeline()
        f = self.f
        self.assertEqual(self.page.locator('iframe').get_attribute('sandbox'), 'allow-scripts')
        self.assertTrue(f.evaluate('(()=>{try{void parent.document;return false}catch(e){return e.name==="SecurityError"}})()'))
        url = f.url
        f.evaluate('''() => {
          familyTimeline.element.append(document.querySelector('#drawer'));
          const original=familyAtlas.showPerson;
          window.qaDefaultCalls=[];
          familyAtlas.showPerson=(id,locate)=>{qaDefaultCalls.push({id,locate});original(id,locate);};
          familyTimeline.show(); // deliberately no callback, use the public default
        }''')
        f.locator('#tl-search').fill('P-0011')
        f.locator('[data-tl-person="P-0011"]').click()
        self.assertEqual(f.evaluate('qaDefaultCalls'), [{'id': 'P-0011', 'locate': False}])
        self.assertTrue(f.locator('#drawer').is_visible())
        self.assertEqual(f.locator('[data-person-detail="P-0011"]').count(), 1)
        f.locator('[data-action="close"]').click()
        f.locator('#tl-search').fill('')
        f.locator('[data-tl-jump="1930"]').focus()
        f.locator('[data-tl-jump="1930"]').press('Enter')
        self.assertEqual(f.url, url)
        self.assertEqual(f.evaluate('document.referrer'), '')
        state = f.evaluate('familyTimeline.getState()')
        f.evaluate('familyTimeline.getState().branch="paternal"')
        self.assertEqual(f.evaluate('familyTimeline.getState()'), state)
        self.evidence.append({'test': self._testMethodName, 'status': 'passed', 'opaque': True,
                              'defaultDispatch': f.evaluate('qaDefaultCalls'), 'URLUnchanged': True})


if __name__ == '__main__':
    unittest.main(verbosity=2)
