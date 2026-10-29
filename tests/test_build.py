"""Build-contract tracer bullet. No input files are modified."""
import json
from pathlib import Path
import unittest

from scripts import build as builder

ROOT = Path(__file__).resolve().parents[1]
class BuildTests(unittest.TestCase):
    def test_release_includes_timeline_page_and_host(self):
        html=builder.build()
        self.assertTrue('window.atlasTimelineHost' in html,'Timeline host missing from release')
        self.assertTrue('familyTimeline' in html,'Timeline code missing from release')
        self.assertTrue('#timeline-page' in html,'Timeline style missing from release')

    def test_build_embeds_complete_model_with_safe_json(self):
        self.assertTrue((ROOT/'scripts'/'build.py').exists(), 'Public atlas builder has not been implemented')
        model=builder.load_model()
        self.assertEqual((len(model['people']),len(model['families'])),(89,23))
        self.assertEqual(next(p['name'] for p in model['people'] if p['id']=='P-0033'),'Шевердова Екатерина Андреевна')
        encoded=builder.safe_json({'probe':'</script><>&'})
        self.assertNotIn('<',encoded);self.assertNotIn('>',encoded);self.assertNotIn('&',encoded)
        self.assertEqual(json.loads(encoded)['probe'],'</script><>&')
        html=builder.build()
        self.assertIn('id="atlas-data"',html)
        self.assertIn('Живой атлас',html)
        self.assertNotIn('src="http',html)

if __name__=='__main__':unittest.main(verbosity=2)
