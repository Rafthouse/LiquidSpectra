# Інструкція з отримання скомпільованих плагінів для Windows та macOS

## Варіант 1: Автоматична збірка через GitHub (Рекомендовано - 0 налаштувань)
Вам не потрібно встановлювати компілятори, Visual Studio чи купувати Mac!
1. Завантажте цей проект у ZIP-архіві кнопкою "Download C++ Project (.zip)".
2. Створіть новий безкоштовний репозиторій на GitHub (наприклад, `liquidspectra-plugin`).
3. Завантажте файли проекту або зробіть `git push`.
4. GitHub автоматично виявить файл `.github/workflows/build-plugins.yml` і запустить дві паралельні хмарні машини:
   - **Windows Runner (MSVC)**: збере `LiquidSpectra.vst3` та `LiquidSpectra.exe`.
   - **macOS Runner (Apple Silicon M-чипи + Intel)**: збере `LiquidSpectra.vst3` та `LiquidSpectra.component` (AU для Logic Pro).
5. Через 5-7 хвилин перейдіть у вкладку **Actions** -> оберіть останній запуск -> внизу в розділі **Artifacts** завантажте готові плагіни!

---

## Варіант 2: Локальна збірка на Windows

### Вимоги:
- Visual Studio 2022 Community (безкоштовна, з галочкою "Desktop development with C++")
- CMake 3.22+

### Команди:
```bash
# 1. Відкрийте термінал у папці проекту
mkdir build && cd build

# 2. Згенеруйте проект для Visual Studio 64-bit
cmake .. -G "Visual Studio 17 2022" -A x64

# 3. Скомпілюйте релізну версію
cmake --build . --config Release --parallel

# 4. Результат буде створено в:
# build/LiquidSpectra_artefacts/Release/VST3/LiquidSpectra.vst3
# build/LiquidSpectra_artefacts/Release/Standalone/LiquidSpectra.exe
```

Плагін автоматично скопіюється в системну папку:
`C:\Program Files\Common Files\VST3\LiquidSpectra.vst3`
Після цього відкрийте Ableton Live, FL Studio або Reaper і зробіть "Rescan Plugins".

---

## Варіант 3: Локальна збірка на macOS

### Вимоги:
- Xcode або Xcode Command Line Tools (`xcode-select --install`)
- CMake (`brew install cmake`)

### Команди:
```bash
# 1. Відкрийте Terminal у папці проекту
mkdir build && cd build

# 2. Згенеруйте Universal Binary (підходить як для M1/M2/M3/M4, так і для Intel)
cmake .. -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"

# 3. Скомпілюйте
cmake --build . --config Release --parallel

# 4. Результат:
# VST3: build/LiquidSpectra_artefacts/Release/VST3/LiquidSpectra.vst3
# AU:   build/LiquidSpectra_artefacts/Release/AU/LiquidSpectra.component
```

Скопіюйте у системні папки:
- VST3: `~/Library/Audio/Plug-Ins/VST3/`
- AU:   `~/Library/Audio/Plug-Ins/Components/`
Запустіть Logic Pro, Ableton чи Reaper — плагін з'явиться у списку ефектів.
