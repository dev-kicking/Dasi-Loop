# Dasi Loop README visual direction

## 컬러 / Color

사용자가 선택한 B안은 사용 예시 중심입니다. README 본문은 GitHub 기본 흑백 스타일을 따르고, 대화 예시 이미지에만 짙은 녹색과 민트를 사용합니다. 보라색 기반의 이전 제안을 대체합니다.

The selected direction B centers on a conversation example. Keep GitHub's native typography and neutral document surface; reserve deep green and mint for the example image.

| 역할 / Role | Color |
| --- | --- |
| 대화 배경 / Conversation background | `#132522` |
| 구분선 / Divider | `#36504A` |
| 본문 / Text | `#EFF9F6` |
| 보조 문구 / Secondary text | `#B9CFC8` |
| 역할 이름과 강조 / Roles and accent | `#77C7B9` |

역할과 의미는 색뿐 아니라 텍스트로도 표시합니다. README의 장식용 기능 카드와 배지 묶음은 제거하고, 대화 예시 → 짧은 흐름 안내 → 설치 순서로 구성합니다.

Role labels carry meaning alongside color. Avoid decorative feature cards and badge clusters. Lead from the example to a short workflow description and installation.

## 모션 / Motion

각 언어에 4.8초짜리 GIF와 같은 내용의 PNG를 제공합니다. GIF는 반복 재생하지 않고 대화가 완성된 화면에서 멈춥니다. README의 `picture`는 `prefers-reduced-motion: reduce`에 PNG를 사용하며, 정지 이미지 링크도 제공합니다. GitHub 클라이언트별 렌더링 차이까지 검증된 것은 아닙니다.

Each language has a 4.8-second, single-play GIF and a static PNG. The README requests the PNG for reduced-motion preferences and also provides a direct static-image link. Client-specific rendering is not guaranteed.

이미지는 가상의 기획 검토 대화 예시이며 실제 실행 녹화나 평가 결과가 아닙니다.

The illustration shows a hypothetical planning conversation; it is not a recorded run or evaluation result.

References: [W3C use of color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html), [W3C pause, stop, hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).
