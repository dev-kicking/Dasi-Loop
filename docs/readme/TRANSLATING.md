# README 번역 추가 / Adding a README language

현재 지원: [한국어](../../README.md) · [English](../../README.en.md)

## 한국어

README 언어는 요청과 번역 검토가 준비될 때 하나씩 추가합니다. 아직 없는 언어를 지원한다고 표시하지 않습니다. 현재 범위는 README와 흐름 이미지이며, 기술 레퍼런스는 영어 문서임을 링크에 표시합니다.

1. 루트에 `README.<언어 코드>.md`를 만듭니다. 한국어 기본 진입점은 `README.md`입니다.
2. 기존 두 README와 같은 절 순서·설치 명령·출시 상태를 유지하고 문구와 대체 텍스트를 번역합니다. 명령, 경로, 기능 ID는 번역하지 않습니다.
3. `scripts/generate-readme-media.py`의 `locales`에 이미지 문구를 추가하고 해당 언어 글꼴로 이미지를 생성합니다. Pillow가 필요합니다. `--font`로 글꼴 경로를 지정할 수 있습니다.
4. 모든 README 상단과 이 문서의 언어 목록에 링크를 추가합니다. `quick-start`와 `documentation` 앵커는 유지합니다.
5. 미배포 기능 안내·업데이트 명령을 모든 언어에서 함께 갱신하고, 글자 잘림·상대 링크·GIF 재생 시간을 확인합니다.

## English

Add a language when a translation and review are available. This covers README content and workflow images; technical references remain in English and should be labeled accordingly.

1. Add `README.<language-code>.md` at the repository root. Korean uses `README.md` as the default entry point.
2. Preserve section order, commands and release status across versions. Translate prose and alt text; keep paths, commands and identifiers unchanged.
3. Add image strings to `locales` in `scripts/generate-readme-media.py`, then generate media with Pillow and a font supporting the language (`--font`).
4. Link the new version from every README and this language list. Keep the stable `quick-start` and `documentation` anchors.
5. Update release notes and commands in all languages together. Inspect text overflow, relative links and animation duration.
