"""Authorised case update: surname correction, separate historical candidate and owned media."""
import unittest
from scripts.build import load_model
class EfimResearchTests(unittest.TestCase):
 def test_family_name_corrected_but_archive_birth_death_not_transferred(self):
  m=load_model();p=next(x for x in m['people'] if x['id']=='P-0034')
  self.assertEqual(p['name'],'Сорокин Ефим Иванович');self.assertFalse(p['birth']);self.assertFalse(p['death']);self.assertIn('A-0032',p['source_ids']);self.assertNotIn('A-0036',p['source_ids']);self.assertIn('C-0013',p['record_matches'])
 def test_candidate_is_distinct_comparison_with_sources_and_actual_media(self):
  m=load_model();p=next(x for x in m['people'] if x['id']=='C-0013');self.assertEqual(p['kind'],'record');self.assertEqual(p['birth'],'1912')
  f=next(x for x in m['families'] if x['id']=='F-efim-maria');self.assertIn('C-0013',[x['person_id'] for x in f['related']]);self.assertNotIn('C-0013',f['parents']);self.assertNotIn('C-0013',f['children'])
  media=[d for d in m['documents'] if d['person_id']=='C-0013'];self.assertTrue(any(d['kind']=='photo' for d in media));self.assertGreaterEqual(len(media),5);self.assertTrue(all(d['identity_status']=='unconfirmed' for d in media))
  self.assertFalse(any(d['person_id']=='P-0034' for d in m['documents']))
  self.assertTrue(any(r['record_ids']==['C-0013'] for r in m['comparisons'] if r['person_id']=='P-0034'))
  for s in p['source_ids']:self.assertIn(s,{x['id'] for x in m['sources']})
if __name__=='__main__':unittest.main()
