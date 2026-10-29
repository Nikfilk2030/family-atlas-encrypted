"""Chronological graph tracer bullets. Exercise the actual offline release."""
import hashlib
import json
import unittest
from playwright.sync_api import sync_playwright
from scripts import build
from tests.support import RESULTS, chrome_executable

QA = RESULTS / 'graph-time'


class GraphTimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        QA.mkdir(parents=True, exist_ok=True)
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True, executable_path=chrome_executable())
        cls.evidence = []

    @classmethod
    def tearDownClass(cls):
        (QA / 'results.json').write_text(json.dumps({'chrome': cls.browser.version, 'checks': cls.evidence,
            'artifactSHA256': hashlib.sha256(build.build().encode()).hexdigest()}, ensure_ascii=False, indent=2), encoding='utf-8')
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1440, 'height': 960})
        self.addCleanup(self.context.close)
        self.requests, self.errors = [], []
        self.context.route('**/*', lambda r: (self.requests.append(r.request.url), r.abort()))
        self.page = self.context.new_page()
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.set_content(build.build())
        self.settle()

    def tearDown(self):
        self.assertEqual(self.errors, [])
        self.assertEqual(self.requests, [])
        self.context.close()

    def settle(self):
        self.page.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')

    def test_same_canvas_mode_switch_projects_actual_births_and_restores_generations(self):
        p = self.page
        normal = p.evaluate('()=>({boxes:[...familyAtlas.boxes],occurrences:[...familyAtlas.occurrences]})')
        p.evaluate('familyAtlas.commit(.43,321,789,"manual")')
        camera = p.evaluate('({...familyAtlas.treeState})')
        switch = p.get_by_role('button', name='По годам', exact=True)
        self.assertEqual(switch.count(), 1, 'A visible same-tree chronological mode is missing')
        switch.click()
        self.settle()
        self.assertEqual(p.evaluate('familyAtlas.state.layoutMode'), 'years')
        self.assertEqual(p.locator('#timeline-page:visible').count(), 0, 'Do not replace the graph with the alternate timeline list')
        self.assertEqual(p.locator('#map [data-family]').count(), 23)
        self.assertEqual(p.evaluate('new Set([...document.querySelectorAll("[data-person-node]")].map(n=>n.dataset.personNode).filter(id=>id.startsWith("P-"))).size'), 37)
        self.assertEqual(p.locator('[data-family-edge]').count(), 22)
        projected = p.evaluate('''()=>{const a=familyAtlas;return [...a.occurrences.values()].map(o=>({id:o.id,
            birth:familyTimeline.parseBirth(a.model.people.find(p=>p.id===o.id).birth),
            temporal:o.temporal,anchorY:o.y+o.h/2,expected:o.temporal?.year==null?null:a.graphTime.yearY(o.temporal.year)}))}''')
        for o in projected:
            self.assertEqual(o['temporal']['kind'], o['birth']['kind'])
            if o['birth']['kind'] == 'unknown':
                self.assertIsNone(o['temporal']['year'], o['id'])
            else:
                year = o['birth']['year'] if o['birth']['year'] is not None else (o['birth']['startYear'] + o['birth']['endYear']) / 2
                self.assertEqual(o['temporal']['year'], year)
                self.assertAlmostEqual(o['anchorY'], o['expected'])
        p.screenshot(path=str(QA/'temporal-overview-desktop.png'))
        temporal_camera = p.evaluate('({...familyAtlas.treeState})')
        p.get_by_role('button', name='Поколения', exact=True).click()
        self.settle()
        after = p.evaluate('()=>({boxes:[...familyAtlas.boxes],occurrences:[...familyAtlas.occurrences]})')
        self.assertEqual(normal, after, 'The accepted generational layout must stay byte-for-byte equivalent')
        for k in ['scale', 'cx', 'cy']:
            self.assertAlmostEqual(p.evaluate('familyAtlas.treeState.'+k), camera[k])
        switch.click()
        self.settle()
        for k in ['scale', 'cx', 'cy']:
            self.assertAlmostEqual(p.evaluate('familyAtlas.treeState.'+k), temporal_camera[k])
        self.evidence.append({'test': self._testMethodName, 'families': 23, 'familyPeople': 37, 'occurrences': len(projected), 'networkRequests': self.requests})

    def test_year_axis_aligns_real_person_birth_through_pan_zoom_and_drawer(self):
        p=self.page
        p.get_by_role('button', name='По годам', exact=True).click();self.settle()
        self.assertEqual(p.locator('#graph-year-axis:visible').count(),1,'Real right-side year axis missing')
        self.assertEqual(p.locator('.overview-label.summary-mark').count(),0,'Desktop temporal overview must name its families, not show anonymous blocks')
        p.evaluate('familyAtlas.showPerson("P-0012",false)');self.settle()
        samples=[]
        for scale in [.12,.4,.72,1.2]:
            p.evaluate('s=>{const o=familyAtlas.occurrences.get("F-sorokin:P-0012");familyAtlas.commit(s,o.x+120,o.y+105-70/s,"manual")}',scale);self.settle()
            measure=p.evaluate('''()=>{const a=familyAtlas,o=a.occurrences.get('F-sorokin:P-0012'),map=document.querySelector('#map').getBoundingClientRect(),axis=document.querySelector('#graph-year-axis').getBoundingClientRect(),card=document.querySelector('[data-family="F-sorokin"] [data-person-node="P-0012"]').getBoundingClientRect(),tick=document.querySelector('[data-axis-year="1934"]').getBoundingClientRect();return{scale:a.treeState.scale,cardY:(card.top+card.bottom)/2,tickY:(tick.top+tick.bottom)/2,mapRight:map.right,axisLeft:axis.left,axisRight:axis.right,drawerLeft:document.querySelector('#drawer').getBoundingClientRect().left}}''')
            self.assertAlmostEqual(measure['cardY'],measure['tickY'],delta=1)
            self.assertGreaterEqual(measure['axisLeft'],measure['mapRight']-1)
            self.assertLessEqual(measure['axisRight'],measure['drawerLeft']+1)
            samples.append(measure)
        sep=p.locator('#drawer-resizer');sep.focus();sep.press('ArrowLeft');self.settle()
        p.screenshot(path=str(QA/'year-axis-selected-person.png'))
        for pid in ['P-0006','P-0018','P-0016']:
            p.evaluate('(id)=>{familyAtlas.showPerson(id,false);familyAtlas.locatePerson(id)}',pid);self.settle()
            cards=p.locator('[data-person-node="'+pid+'"] .time-birth')
            self.assertGreater(cards.count(),0)
            raw=p.evaluate('id=>familyAtlas.model.people.find(p=>p.id===id).birth',pid)
            if raw:self.assertEqual(cards.first.inner_text(),raw)
            else:self.assertEqual(cards.first.inner_text(),'Дата рождения неизвестна')
        # The same existing parser is authoritative; death and children never supply a year.
        self.assertEqual(p.locator('[data-family="F-ponomarev"] [data-person-node="P-0016"].time-unknown').count(),1)
        self.assertEqual(p.locator('.time-undated').count(),0,'Latest user instruction keeps unknown people with their generation')
        self.assertIn('условно',p.locator('[data-family="F-ponomarev"] [data-person-node="P-0016"]').inner_text().lower())
        self.evidence.append({'test':self._testMethodName,'alignment':samples})
    def test_cross_family_routes_avoid_unrelated_families_and_land_on_actual_shared_people(self):
        p=self.page
        for mode in ['generations','years']:
            p.evaluate('(mode)=>familyAtlas.setLayoutMode(mode)',mode);self.settle()
            p.evaluate('familyAtlas.showPerson("P-0001",false);familyAtlas.closeDrawer();familyAtlas.fitTree()');self.settle()
            for detail in [False,True]:
                p.evaluate('(detail)=>familyAtlas.commit(detail?.72:familyAtlas.treeState.scale,familyAtlas.treeState.cx,familyAtlas.treeState.cy,"manual")',detail);self.settle()
                bad=p.evaluate('''detail=>{const bad=[],a=familyAtlas;const selector=detail?'[data-continuation-edge]':'[data-family-edge]';for(const n of document.querySelectorAll(selector)){const key=n.dataset.continuationEdge||n.dataset.familyEdge,[from,to]=key.split(':'),len=n.getTotalLength();for(let d=0;d<=len;d+=8){const p=n.getPointAtLength(d);for(const [id,b]of (detail?a.boxes:a.summaryFrames)){const x=detail?b.x+(b.w-b.innerW)/2:b.x,w=detail?b.innerW:b.w;if((!detail||id!==from&&id!==to)&&p.x>x+1&&p.x<x+w-1&&p.y>b.y+1&&p.y<b.y+b.h-1){bad.push(key+':through:'+id);d=len+1;break;}}}if(detail){const id=n.dataset.throughPerson,source=a.occurrences.get(from+':'+id),target=a.occurrences.get(to+':'+id),s=n.getPointAtLength(0),t=n.getPointAtLength(len),on=(p,o)=>o&&((Math.abs(p.x-o.x)<.1||Math.abs(p.x-o.x-o.w)<.1)&&p.y>=o.y&&p.y<=o.y+o.h||(Math.abs(p.y-o.y)<.1||Math.abs(p.y-o.y-o.h)<.1)&&p.x>=o.x&&p.x<=o.x+o.w);if(!on(s,source)||!on(t,target))bad.push(key+':not-the-shared-person');for(let d=2;d<len-2;d+=8){const p=n.getPointAtLength(d);for(const o of a.occurrences.values())if((o.family===from||o.family===to)&&o.id!==id&&p.x>o.x+1&&p.x<o.x+o.w-1&&p.y>o.y+1&&p.y<o.y+o.h-1){bad.push(key+':through-card:'+o.id);d=len;break;}}}}return bad}''',detail)
                self.assertEqual(bad,[],(mode,detail))
                if detail:self.assertEqual(p.locator('[data-continuation-edge]').count(),22,'Detail must continue the actual shared individual, not arbitrary family centers')
            if mode=='generations':
                p.evaluate('()=>{const b=familyAtlas.boxes.get("F-erchenko");familyAtlas.commit(.72,b.x+b.w/2-300,b.y+b.h-200,"manual")}');self.settle()
                p.screenshot(path=str(QA/'routing-user-example-72-percent.png'))
                p.evaluate('familyAtlas.fitTree()');self.settle()
                p.screenshot(path=str(QA/'normal-generations-regression.png'))
        self.evidence.append({'test':self._testMethodName,'modes':2,'identityContinuations':22,'obstacleViolations':0})
    def test_status_words_custom_popover_focus_touch_viewport_and_section_click(self):
        p=self.page
        p.evaluate('familyAtlas.showPerson("P-0018",false)');self.settle()
        badge=p.locator('.profile-header [data-status="female"]')
        self.assertEqual(badge.get_attribute('aria-label'),'Женщина','Everyday status must use human words, not a source-analysis sentence')
        self.assertIsNone(badge.get_attribute('title'),'Do not restore giant native browser title strips')
        badge.hover();self.settle()
        tooltip=p.get_by_role('tooltip');self.assertTrue(tooltip.is_visible())
        self.assertIn('Женщина',tooltip.inner_text())
        self.assertNotIn('Явная',tooltip.inner_text())
        p.screenshot(path=str(QA/'human-status-tooltip.png'))
        badge.focus();badge.press('Escape');self.settle()
        self.assertFalse(tooltip.is_visible());self.assertEqual(p.evaluate('familyAtlas.state.selected'),'P-0018')
        badge=p.locator('.profile-header [data-status="possible"]');badge.focus();self.settle()
        self.assertIn('Возможное совпадение',tooltip.inner_text())
        badge.click();self.settle()
        self.assertEqual(p.locator('[data-section-target="uncertainties"]').get_attribute('aria-current'),'location')
        p.set_viewport_size({'width':390,'height':844});self.settle()
        p.evaluate('familyAtlas.showPerson("P-0018",false)');self.settle()
        badge=p.locator('.profile-header [data-status="female"]');r=badge.bounding_box()
        cdp=self.context.new_cdp_session(p)
        cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':r['x']+r['width']/2,'y':r['y']+r['height']/2}]})
        cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});self.settle()
        self.assertTrue(tooltip.is_visible())
        anchor=p.locator('.profile-header [data-status="female"]').bounding_box()
        self.assertGreaterEqual(anchor['y'],p.locator('#drawer').bounding_box()['y']+p.locator('.drawer-top').bounding_box()['height'],'A touch status action must not scroll its own anchor out of the dossier')
        bounds=tooltip.bounding_box();self.assertGreaterEqual(bounds['x'],0);self.assertLessEqual(bounds['x']+bounds['width'],390)
        self.assertGreaterEqual(bounds['y'],0);self.assertLessEqual(bounds['y']+bounds['height'],844)
        self.assertEqual(p.locator('.profile-header [data-status="female"]').get_attribute('aria-label'),'Женщина')
        self.assertIn('Явная женская семейная роль',p.locator('.sex-basis').text_content(),'Source rationale belongs in dossier disclosure only')
        p.screenshot(path=str(QA/'human-status-tooltip-mobile.png'))
        self.evidence.append({'test':self._testMethodName,'mobilePopover':bounds})
    def test_temporal_uncertainty_geometry_all_members_subtrees_mobile_and_zero_size(self):
        p=self.page;p.get_by_role('button',name='По годам',exact=True).click();self.settle()
        self.assertGreater(p.locator('[data-birth-range]').count(),0,'Ranges need a visible extent, not a fabricated midpoint year')
        self.assertEqual(p.locator('[data-axis-year="1969.5"]').count(),0)
        p.evaluate('familyAtlas.showPerson("P-0006",false);familyAtlas.locatePerson("P-0006")');self.settle()
        self.assertEqual(p.locator('[data-axis-year="1969.5"]').count(),0,'A range midpoint is not an actual known birth year')
        samples=[]
        for width,height in [(1440,960),(390,844),(844,390)]:
            p.set_viewport_size({'width':width,'height':height});self.settle()
            p.evaluate('familyAtlas.closeDrawer();familyAtlas.showTree();familyAtlas.fitTree()');self.settle()
            fit=p.evaluate('familyAtlas.treeState.scale')
            p.locator('[data-action="minus"]').click();self.settle()
            self.assertLess(p.evaluate('familyAtlas.treeState.scale'),fit,'Minus at the full temporal overview must actually zoom OUT, even on mobile')
            p.evaluate('familyAtlas.fitTree()');self.settle()
            for scale in [fit,fit*.7,.08,.24,.4,.57,.58,.72,1.2]:
                p.evaluate('s=>familyAtlas.commit(s,familyAtlas.treeState.cx,familyAtlas.treeState.cy,"manual")',scale);self.settle()
                bad=p.evaluate('''()=>{const a=familyAtlas,bad=[],nodes=[...document.querySelectorAll('.overview-label,.territory')].filter(n=>getComputedStyle(n).visibility!=='hidden'&&getComputedStyle(n).display!=='none').map(n=>({id:n.dataset.family||n.dataset.openFamily,r:n.getBoundingClientRect()}));for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const l=nodes[i],r=nodes[j];if(Math.min(l.r.right,r.r.right)-Math.max(l.r.left,r.r.left)>.5&&Math.min(l.r.bottom,r.r.bottom)-Math.max(l.r.top,r.r.top)>.5)bad.push(l.id+':'+r.id);}for(const o of a.occurrences.values()){const b=a.boxes.get(o.family);if(o.x<b.x||o.y<b.y||o.x+o.w>b.x+b.w||o.y+o.h>b.y+b.h)bad.push('outside:'+o.id);}for(const n of document.querySelectorAll('.person'))if(n.scrollWidth>n.clientWidth+1||n.scrollHeight>n.clientHeight+1)bad.push('text:'+n.dataset.personNode);for(const n of document.querySelectorAll('[data-birth-range]')){const b=n.closest('.territory').getBoundingClientRect(),r=n.getBoundingClientRect();if(r.top<b.top-1||r.bottom>b.bottom+1)bad.push('range-outside:'+n.dataset.birthRange);}return bad}''')
                self.assertEqual(bad,[],(width,height,scale));samples.append([width,height,scale])
            p.evaluate('familyAtlas.showFamily("F-ponomarev","ancestors")');self.settle()
            self.assertEqual(set(p.evaluate('familyAtlas.state.visible')),{'F-ponomarev','F-hyp-ponomarev','F-hyp-maxim','F-hyp-cytko'})
            p.evaluate('familyAtlas.showTree();familyAtlas.showPerson("P-0001",false)');self.settle()
            self.assertGreater(p.locator('.route-detail.lineage-maternal').count(),0)
            self.assertGreater(p.locator('.route-detail.lineage-paternal').count(),0)
            sep=p.locator('#drawer-resizer');camera=p.evaluate('({...familyAtlas.treeState})');sep.focus();sep.press('ArrowLeft' if width>760 else 'ArrowUp');self.settle()
            for k in ['scale','cx','cy']:self.assertAlmostEqual(p.evaluate('familyAtlas.treeState.'+k),camera[k])
            if width==390:
                p.evaluate('familyAtlas.showPerson("P-0006",false);familyAtlas.locatePerson("P-0006")');self.settle()
                self.assertEqual(p.evaluate('document.documentElement.scrollWidth'),390)
                p.screenshot(path=str(QA/'temporal-mobile-selected.png'))
                p.locator('[data-action="close"]').click();p.locator('[data-action="home"]').click();self.settle()
                self.assertEqual(p.evaluate('familyAtlas.state.layoutMode'),'years')
                p.screenshot(path=str(QA/'temporal-mobile-home.png'))
        p.evaluate('document.querySelector("#map").style.height="0px";familyAtlas.fitTree()');self.settle()
        self.assertGreater(p.evaluate('familyAtlas.treeState.scale'),0)
        p.evaluate('document.querySelector("#map").style.height=""');self.settle()
        self.assertGreater(p.evaluate('new DOMMatrixReadOnly(getComputedStyle(document.querySelector("#world")).transform).a'),0)
        self.evidence.append({'test':self._testMethodName,'geometrySamples':samples,'networkRequests':self.requests})
    def test_continuations_avoid_internal_context_labels_and_temporal_parent_paths_avoid_other_cards(self):
        p=self.page
        for mode in ['generations','years']:
            p.evaluate('(mode)=>familyAtlas.setLayoutMode(mode)',mode);self.settle()
            bad=p.evaluate('''mode=>{const a=familyAtlas,bad=[];for(const n of document.querySelectorAll('[data-continuation-edge]')){const [from,to]=n.dataset.continuationEdge.split(':'),len=n.getTotalLength();for(let d=0;d<len;d+=6){const p=n.getPointAtLength(d);for(const o of a.occurrences.values())if(o.related&&(o.family===from||o.family===to)&&p.x>o.x&&p.x<o.x+o.w&&p.y>o.y-26&&p.y<o.y-2){bad.push(n.dataset.continuationEdge+':context-label:'+o.id);d=len;break;}}}if(mode==='years')for(const n of document.querySelectorAll('.person-path')){const len=n.getTotalLength(),endpoints=[n.dataset.fromPerson,n.dataset.toPerson];if(!len)bad.push(n.dataset.relation+':missing-parent-route');for(let d=1;d<len;d+=6){const p=n.getPointAtLength(d);for(const o of a.occurrences.values())if(!endpoints.includes(o.id)&&p.x>o.x+1&&p.x<o.x+o.w-1&&p.y>o.y+1&&p.y<o.y+o.h-1){bad.push(n.dataset.relation+':parent-through-card:'+o.id);d=len;break;}}}return bad}''',mode)
            self.assertEqual(bad,[],mode)
        self.evidence.append({'test':self._testMethodName,'cardAndContextLabelViolations':0})
    def test_unparseable_births_stay_neutral_even_with_death_and_child_dates(self):
        html=build.build();prefix,_,tail=html.partition('<script id="atlas-data" type="application/json">');raw,_,suffix=tail.partition('</script>')
        model=json.loads(raw)
        for person in model['people']:
            person['birth']='неизвестно';person['dates']='1901–1988';person['death']='1988'
        self.page.goto('about:blank')
        self.page.set_content(prefix+'<script id="atlas-data" type="application/json">'+build.safe_json(model)+'</script>'+suffix);self.settle()
        self.page.get_by_role('button',name='По годам',exact=True).click();self.settle()
        self.assertEqual(self.page.locator('[data-axis-year]').count(),0,'Undated records must not acquire an invented zero-year chronology')
        self.assertTrue(self.page.evaluate('[...familyAtlas.occurrences.values()].every(o=>o.temporal.kind==="unknown"&&o.temporal.year===null)'))
        self.assertEqual(self.page.locator('[data-family]').count(),23)
        self.assertIn('Без дат',self.page.locator('#graph-year-axis').inner_text())
        self.evidence.append({'test':self._testMethodName,'neutralFallback':True,'deathIgnored':True})
    def test_temporal_native_camera_deselection_timeline_return_and_initial_zero_viewport(self):
        p=self.page;p.get_by_role('button',name='По годам',exact=True).click();self.settle()
        p.evaluate('familyAtlas.showPerson("P-0018",false);familyAtlas.focusFamily("F-ponomarev")');self.settle()
        p.screenshot(path=str(QA/'selected-family-temporal.png'))
        before=p.evaluate('({...familyAtlas.treeState})')
        p.get_by_role('button',name='Таймлайн',exact=True).click();self.settle()
        p.get_by_role('button',name='К дереву',exact=True).click();self.settle()
        self.assertEqual(p.evaluate('familyAtlas.state.layoutMode'),'years')
        for k in ['cx','cy','scale']:self.assertAlmostEqual(before[k],p.evaluate('familyAtlas.treeState.'+k))
        p.evaluate('familyAtlas.showPerson("P-0018",false)');self.settle()
        point=p.evaluate('''()=>{const r=document.querySelector('#map').getBoundingClientRect();for(let y=r.top+180;y<r.bottom-150;y+=20)for(let x=r.left+8;x<r.right-20;x+=20){const n=document.elementFromPoint(x,y);if(n?.closest('#map')&&!n.closest('button,a,.person,[data-edge-hit],[data-continuation-hit]'))return{x,y};}return null}''')
        self.assertIsNotNone(point)
        before=p.evaluate('({...familyAtlas.treeState})');p.mouse.move(point['x'],point['y']);p.mouse.down();p.mouse.move(point['x']+35,point['y']+20,steps=4);p.mouse.up();self.settle()
        self.assertNotEqual(before['cx'],p.evaluate('familyAtlas.treeState.cx'));self.assertEqual(p.evaluate('familyAtlas.state.selected'),'P-0018')
        # Panning moves cards beneath the old screen coordinate: discover blank space again.
        point=p.evaluate('''()=>{const r=document.querySelector('#map').getBoundingClientRect();for(let y=r.top+180;y<r.bottom-150;y+=20)for(let x=r.left+8;x<r.right-20;x+=20){const n=document.elementFromPoint(x,y);if(n?.closest('#map')&&!n.closest('button,a,.person,[data-edge-hit],[data-continuation-hit]'))return{x,y};}return null}''')
        self.assertIsNotNone(point)
        before=p.evaluate('({...familyAtlas.treeState})');p.mouse.click(point['x'],point['y']);self.settle()
        self.assertIsNone(p.evaluate('familyAtlas.state.selected'))
        for k in ['cx','cy','scale']:self.assertAlmostEqual(before[k],p.evaluate('familyAtlas.treeState.'+k))
        for dimension in ['width','height']:
            p.goto('about:blank');p.set_content('<style>html,body{height:100%;margin:0}iframe{width:100%;height:100%;border:0;display:block}</style>')
            p.evaluate('([html,dim])=>{const f=document.createElement("iframe");f.sandbox="allow-scripts";f.style[dim]="0px";f.src=URL.createObjectURL(new Blob([html],{type:"text/html"}));document.body.append(f)}',[build.build(),dimension])
            f=p.frames[1];f.wait_for_load_state();f.evaluate('familyAtlas.setLayoutMode("years")')
            self.assertFalse(f.evaluate('familyAtlas.treeState.initialized'))
            self.assertGreater(f.evaluate('familyAtlas.treeState.scale'),0)
            p.evaluate('dim=>document.querySelector("iframe").style[dim]="100%"',dimension)
            f.wait_for_function('()=>familyAtlas.treeState.initialized')
            f.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
            self.assertEqual(f.locator('[data-family]').count(),23)
            self.assertGreater(f.locator('[data-axis-year]').count(),0)
            self.assertTrue(f.evaluate('(()=>{try{void parent.document;return false}catch{return true}})()'))
            self.assertGreater(f.evaluate('new DOMMatrixReadOnly(getComputedStyle(document.querySelector("#world")).transform).a'),0)
        self.evidence.append({'test':self._testMethodName,'zeroWidthHeightRecovery':True,'opaqueIframe':True,'nativePanAndDeselect':True})
    def test_temporal_summaries_and_selected_mobile_name_are_not_covered(self):
        p=self.page;p.get_by_role('button',name='По годам',exact=True).click();self.settle()
        overflow=p.locator('.overview-label:not(.summary-mark)').evaluate_all('ns=>ns.filter(n=>n.scrollHeight>n.clientHeight+1).map(n=>n.dataset.openFamily)')
        self.assertEqual(overflow,[],'Family date summaries must not be clipped at the desktop overview')
        p.set_viewport_size({'width':390,'height':844});self.settle()
        p.evaluate('familyAtlas.showPerson("P-0006",false);familyAtlas.locatePerson("P-0006")');self.settle()
        covered=p.evaluate('''()=>{const n=document.querySelector('[data-family="'+familyAtlas.state.family+'"] .person.selected strong').getBoundingClientRect(),r=document.querySelector('#lineage-legend').getBoundingClientRect();return Math.min(n.right,r.right)>Math.max(n.left,r.left)&&Math.min(n.bottom,r.bottom)>Math.max(n.top,r.top)}''')
        self.assertFalse(covered,'The selected mobile name must not sit under the lineage legend')
        self.evidence.append({'test':self._testMethodName,'clippedSummaries':overflow,'mobileNameCovered':covered})


if __name__ == '__main__':
    unittest.main(verbosity=2)
