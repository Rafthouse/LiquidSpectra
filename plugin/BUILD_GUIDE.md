# Збірка LiquidSpectra (VST3 / AU / Standalone)

Плагін зібрано на JUCE 8.0.15 (завантажується автоматично через CMake FetchContent).
Формати: VST3 і Standalone на Windows; VST3, AU і Standalone на macOS.

## Варіант 1: GitHub Actions (без локальних компіляторів)
1. Завантажте проєкт (кнопка "Download C++ Project (.zip)") і створіть із нього репозиторій на GitHub.
2. Воркфлоу `.github/workflows/build-plugins.yml` збере Windows x64 і macOS Universal (arm64 + x86_64)
   та запустить DSP-тести (`ctest`). Якщо тест не пройде — збірка впаде.
3. Готові файли — у вкладці **Actions** → останній запуск → **Artifacts**.

## Варіант 2: Windows
Вимоги: Visual Studio 2022 або 2026 ("Desktop development with C++"), CMake 3.22+.

```bash
cmake -B build -A x64
cmake --build build --config Release --parallel
ctest --test-dir build -C Release --output-on-failure
```

Результат:
- `build/LiquidSpectra_artefacts/Release/VST3/LiquidSpectra.vst3`
- `build/LiquidSpectra_artefacts/Release/Standalone/LiquidSpectra.exe`

Скопіюйте `LiquidSpectra.vst3` у `C:\Program Files\Common Files\VST3\` (потрібні права адміністратора)
і пересканойте плагіни в DAW. Автоматичне копіювання вимкнено (`COPY_PLUGIN_AFTER_BUILD FALSE`),
бо без прав адміністратора воно ламає збірку.

Порада: на Windows тримайте каталог збірки на короткому шляху (наприклад `C:\dev\liquidspectra`) —
JUCE створює глибокі шляхи і може впертися в обмеження MAX_PATH.

Щоб не завантажувати JUCE щоразу, вкажіть наявну копію: `-DLIQUIDSPECTRA_JUCE_DIR=C:/path/to/JUCE`.

## Варіант 3: macOS
Вимоги: Xcode, CMake (`brew install cmake`).

```bash
cmake -B build -G Xcode -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
cmake --build build --config Release --parallel
ctest --test-dir build -C Release --output-on-failure
```

Результат: `VST3/LiquidSpectra.vst3`, `AU/LiquidSpectra.component`, `Standalone/LiquidSpectra.app`
у `build/LiquidSpectra_artefacts/Release/`. Скопіюйте їх у `~/Library/Audio/Plug-Ins/VST3/` та
`~/Library/Audio/Plug-Ins/Components/`.

## Примітки
- Кілька екземплярів плагіна в одному DAW обмінюються спектрами через спільну шину в пам'яті процесу.
  Хости, що запускають плагіни в окремих процесах (sandbox), бачитимуть лише власну доріжку.
- `Source/SkiaVectorRenderer.*` — експериментальний рендерер на Skia, у збірку не входить.
