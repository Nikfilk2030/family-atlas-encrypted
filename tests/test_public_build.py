"""Public, portable build contract: no private research checkout may be required."""
import copy
import json
import re
import tempfile
import unittest
from pathlib import Path

from scripts import build as builder

ROOT = Path(__file__).resolve().parents[1]


class PublicBuildTests(unittest.TestCase):
    def test_rebuild_is_exactly_the_committed_standalone(self):
        self.assertEqual(builder.build().encode('utf-8'), (ROOT / 'index.html').read_bytes())

    def test_public_source_data_contains_asset_references_not_base64_blobs(self):
        raw = (ROOT / 'data/atlas.json').read_text(encoding='utf-8')
        self.assertNotIn('data:image/', raw)
        model = json.loads(raw)
        self.assertTrue(all('asset' in d and 'data_uri' not in d for d in model['documents']))
        embedded = builder.load_model()
        self.assertTrue(all(d['data_uri'].startswith('data:image/') for d in embedded['documents']))
        self.assertTrue(all('asset' not in d and 'media_type' not in d for d in embedded['documents']))

    def test_safe_json_preserves_literals_without_breaking_inline_script(self):
        value = {'probe': '</script><>&\u2028\u2029'}
        encoded = builder.safe_json(value)
        self.assertEqual(json.loads(encoded), value)
        self.assertFalse(any(s in encoded for s in ['<', '>', '&', '\u2028', '\u2029']))

    def test_duplicate_person_ids_are_rejected_not_silently_normalized(self):
        model = builder.load_model()
        model['people'].append(copy.deepcopy(model['people'][0]))
        with self.assertRaises(builder.BuildError):
            builder.validate_model(model)

    def test_entire_assets_directory_cannot_symlink_outside_the_checkout(self):
        with tempfile.TemporaryDirectory() as folder:
            base = Path(folder)
            checkout = base / 'checkout'
            outside = base / 'outside'
            checkout.mkdir()
            outside.mkdir()
            raw = (ROOT / 'assets/documents/sorokin-budem-zhit-p525.png').read_bytes()
            (outside / 'image.png').write_bytes(raw)
            (checkout / 'assets').symlink_to(outside, target_is_directory=True)
            with self.assertRaises(builder.BuildError):
                builder.embed_documents({'documents': [{'asset': 'assets/image.png', 'media_type': 'image/png'}]}, checkout)

    def test_malformed_document_shapes_fail_as_validation_errors(self):
        for model in [[], {'documents': None}, {'documents': ['not-an-object']}, {'documents': [{'asset': 'assets/image.png', 'media_type': []}]}]:
            with self.subTest(model=model), self.assertRaises(builder.BuildError):
                builder.embed_documents(model, ROOT)

    def test_asset_path_cannot_escape_the_repository(self):
        with self.assertRaises(builder.BuildError):
            builder.embed_documents({'documents': [{'asset': '../outside.png', 'media_type': 'image/png'}]}, ROOT)


if __name__ == '__main__':
    unittest.main()
