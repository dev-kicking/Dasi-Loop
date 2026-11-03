# -*- coding: utf-8 -*-
"""Generate README conversation examples with Pillow and a Korean-capable font.
Usage: python3 scripts/generate-readme-media.py --font /path/to/font.ttf
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--font', default='/System/Library/Fonts/AppleSDGothicNeo.ttc')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / 'docs' / 'readme'
root.mkdir(parents=True, exist_ok=True)
font = lambda size: ImageFont.truetype(args.font, size)
BG, TEXT, MUTED, ACCENT = '#132522', '#EFF9F6', '#B9CFC8', '#77C7B9'
locales = {
    'ko': ('대화 예시', '사용자', '로그인 실패 시 재시도 기능을 만들어줘.', '에이전트', 'PRD 초안을 만들었습니다. 먼저 한 가지를 정할까요?', ['추천: 최대 3회 재시도 후 직접 다시 시도할 수 있게 안내합니다.', '이유: 반복 실패를 제한하면서 사용자가 복구할 수 있습니다.']),
    'en': ('Conversation example', 'YOU', 'Add a retry flow when sign-in fails.', 'AGENT', 'I drafted a PRD. Shall we decide one thing first?', ['Recommendation: retry up to 3 times, then offer a manual retry.', 'Why: limit repeated failures while giving the user a way to recover.']),
}
for lang, (caption, user, request, agent, question, advice) in locales.items():
    frames = []
    for stage in range(3):
        im = Image.new('RGB', (1200, 420), BG)
        d = ImageDraw.Draw(im)
        d.text((40, 26), f'DASI LOOP / {caption}', font=font(16), fill=ACCENT)
        d.text((40, 80), user, font=font(16), fill=ACCENT)
        d.text((40, 111), request, font=font(30), fill=TEXT)
        d.line((40, 175, 1160, 175), fill='#36504A', width=1)
        if stage >= 1:
            d.text((40, 202), agent, font=font(16), fill=ACCENT)
            d.text((40, 233), question, font=font(28), fill=TEXT)
        if stage >= 2:
            for i,line in enumerate(advice):
                d.text((40, 297+i*39), line, font=font(23), fill=MUTED)
        frames.append(im)
    frames[-1].save(root/f'workflow.{lang}.png', optimize=True)
    palette = frames[-1].quantize(colors=96)
    converted = [f.quantize(palette=palette) for f in frames]
    converted[0].save(root/f'workflow.{lang}.gif', save_all=True, append_images=converted[1:], duration=[1100,1500,2200], optimize=True, disposal=2)
    print(lang, (root/f'workflow.{lang}.gif').stat().st_size, 'bytes')
