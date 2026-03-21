#!/usr/bin/env python3
"""Parse dropshipping.ua XML feed 3539 -> static JSON files for beauty shop."""

import html, json, os, re, sys, urllib.request
from xml.etree.ElementTree import parse, fromstring

OUT_DIR = os.path.join(os.path.dirname(__file__), 'data')
FEED_URL = os.environ.get('FEED_URL', '')
XML_PATH = 'C:/tmp/feed3539.xml'

GROUPS = [
    {
        "id": "vitaminy",
        "name": "Вітаміни та здоровʼя",
        "icon": "heart",
        "cats": [
            43718,
            43719,
            40754,
            40755
        ]
    },
    {
        "id": "parfum",
        "name": "Парфумерія",
        "icon": "droplet",
        "cats": [
            32010,
            32011,
            32012
        ]
    },
    {
        "id": "tvorchist",
        "name": "Творчість та мистецтво",
        "icon": "star",
        "cats": [
            8696,
            8697,
            8698,
            10589
        ]
    },
    {
        "id": "gigiena",
        "name": "Гігієна та догляд",
        "icon": "shield",
        "cats": [
            10094,
            10095,
            10096,
            10097,
            47733,
            47734,
            47735
        ]
    },
    {
        "id": "krasa",
        "name": "Краса та манікюр",
        "icon": "scissors",
        "cats": [
            32829,
            32835,
            37938,
            37931,
            37942,
            16765,
            32840,
            47731,
            47732
        ]
    }
]

CAT_NAMES_UK = {
    8696: "Фарби та лаки художні",
    8697: "Набори художніх фарб",
    8698: "Полотна, борди, папір",
    10094: "Рідке мило",
    10095: "Гель для душу",
    10096: "Антисептики",
    10097: "Пасти для рук",
    10589: "Набори для творчості",
    16765: "Косметичні прилади",
    32010: "Жіноча парфумерія",
    32011: "Чоловіча парфумерія",
    32012: "Унісекс парфумерія",
    32829: "Манікюрні ножиці та кусачки",
    32835: "Манікюрні пилочки",
    32840: "Аксесуари для окулярів",
    37931: "Косметичні дзеркала",
    37938: "Лампи для гель-лаку",
    37942: "Масажери для тіла",
    40754: "БАДи",
    40755: "Спортивне харчування",
    43718: "Вітаміни",
    43719: "Дитячі додатки",
    47731: "Косметика по догляду",
    47732: "Засоби для похуднення",
    47733: "Крем для обличчя",
    47734: "Маски для шкіри обличчя",
    47735: "Парафінотерапія",
}


def strip_html(text):
    if not text:
        return ''
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    return re.sub(r'[ \t]+', ' ', text).strip()


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    print('Parsing XML...')
    if FEED_URL:
        print(f'Downloading from {FEED_URL}')
        with urllib.request.urlopen(FEED_URL, timeout=120) as r:
            root = fromstring(r.read())
        shop = root.find('shop')
    else:
        tree = parse(XML_PATH)
        shop = tree.getroot().find('shop')

    cat_map = {}
    for c in shop.find('categories').findall('category'):
        cid = int(c.get('id'))
        cat_map[cid] = CAT_NAMES_UK.get(cid, c.text or str(cid))

    offers_by_cat = {}
    all_vendors = set()

    for o in shop.find('offers').findall('offer'):
        cat_id = int(o.findtext('categoryId') or 0)
        vendor = o.findtext('vendor') or ''
        if vendor:
            all_vendors.add(vendor)
        product = {
            'id': o.get('id'),
            'available': o.get('available') == 'true',
            'name': o.findtext('name') or '',
            'price': float(o.findtext('price') or 0),
            'vendor': vendor,
            'vendorCode': o.findtext('vendorCode') or '',
            'categoryId': cat_id,
            'pictures': [p.text for p in o.findall('picture') if p.text],
            'description': strip_html(o.findtext('description') or ''),
            'params': [
                {'name': p.get('name'), 'value': p.text}
                for p in o.findall('param')
                if p.text and p.get('name') and len(p.get('name').strip()) > 2
                and not p.get('name').strip().isdigit()
            ],
        }
        offers_by_cat.setdefault(cat_id, []).append(product)

    # Write per-category JSON files
    for cat_id, products in offers_by_cat.items():
        path = os.path.join(OUT_DIR, f'cat_{cat_id}.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(products, f, ensure_ascii=False, separators=(',', ':'))
    print(f'Written {len(offers_by_cat)} category files')

    # Build groups with metadata (only include categories with available products)
    groups_out = []
    for g in GROUPS:
        cats_out = []
        total = 0
        cover = None
        seen_cats = set()
        for cid in g['cats']:
            if cid in seen_cats:
                continue
            seen_cats.add(cid)
            prods = offers_by_cat.get(cid, [])
            count = sum(1 for p in prods if p['available'])
            if count > 0:
                cats_out.append({'id': cid, 'name': cat_map.get(cid, str(cid)), 'count': count})
                total += count
            if not cover:
                for p in prods:
                    if p['available'] and p['pictures']:
                        cover = p['pictures'][0]
                        break
        if cats_out:
            groups_out.append({
                'id': g['id'],
                'name': g['name'],
                'icon': g['icon'],
                'cats': cats_out,
                'total': total,
                'cover': cover,
            })

    # Featured: first available product with photo per group (prioritize big groups)
    featured = []
    seen_cats = set()
    for cat_id, products in offers_by_cat.items():
        for p in products:
            if p['available'] and p['pictures'] and cat_id not in seen_cats:
                featured.append(p)
                seen_cats.add(cat_id)
                break
    featured = sorted(featured, key=lambda x: x['price'], reverse=True)[:24]

    total_prods = sum(len(v) for v in offers_by_cat.values())
    avail_prods = sum(sum(1 for p in v if p['available']) for v in offers_by_cat.values())

    catalog = {
        'groups': groups_out,
        'allCats': [{'id': k, 'name': v} for k, v in sorted(cat_map.items())],
        'vendors': sorted(list(all_vendors)),
        'stats': {
            'total': total_prods,
            'available': avail_prods,
            'categories': len(cat_map),
            'groups': len(groups_out),
        },
    }

    with open(os.path.join(OUT_DIR, 'catalog.json'), 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, separators=(',', ':'))

    with open(os.path.join(OUT_DIR, 'featured.json'), 'w', encoding='utf-8') as f:
        json.dump(featured, f, ensure_ascii=False, separators=(',', ':'))

    print(f'catalog.json: {len(groups_out)} groups, {total_prods} products ({avail_prods} available)')
    print(f'featured.json: {len(featured)} products')
    print('Done!')


if __name__ == '__main__':
    main()
