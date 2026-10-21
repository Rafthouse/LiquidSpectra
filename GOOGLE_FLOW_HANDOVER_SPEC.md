# ТЕХНІЧНА СПЕЦИФІКАЦІЯ ТА АРХІТЕКТУРА ДЛЯ GOOGLE FLOW
## Проект: LiquidSpectra Pro — Преміальний аудіоаналізатор на векторному рушії Skia C++
**Рівень якості та UI-принципи**: FabFilter Pro-Q 3 / Pro-L 2  
**Графічний стек**: Чистий Skia C++ (`SkCanvas`, `SkPath`, `SkPaint`, Metal/Direct3D GPU бэкенди, БЕЗ WebView)  
**Аудіо-стек**: C++20, JUCE 8 AudioProcessor, SIMD AVX2 / ARM NEON, Lock-Free Inter-Plugin Shared Bus  
**Цільові формати**: VST3 (Windows/macOS), Audio Unit / AUv3 (macOS Universal ARM64/x64), Standalone

---

## 1. СУТЬ ТА ГОЛОВНІ ВІДМІННОСТІ ВІД ЗВИЧАЙНИХ РІШЕНЬ

Головна відмінність цієї архітектури від попередніх реалізацій — **100% відмова від будь-яких браузерних оболонок (WebView2 / WKWebView)** на користь **чистої векторної графіки Google Skia C++**:
1. **Нескінченна чіткість (Resolution-Independence)**: Усі лінії, сітки, сплайни та плаваючі ручки малюються математичними векторами. При будь-якому DPI (Retina, 4K, 5K) або зміні розміру вікна інтерфейс залишається ідеально гострим.
2. **Нульове навантаження на CPU**: Skia автоматично транслює векторні шляхи `SkPath` у шейдери GPU через Metal (macOS) або Direct3D 12 / Vulkan (Windows). Навантаження на ЦП становить лише 0.2–0.4% навіть при 60–120 FPS.
3. **Ізоляція аудіопотоку**: Процес малювання ніколи не взаємодіє з системними м'ютексами чи аудіопотоком DAW. Обмін даними відбувається через атомарну lock-free шину.

---

## 2. АРХІТЕКТУРА ДИЗАЙНУ ЗА ПРИНЦИПАМИ FABFILTER

### 2.1. Візуальна мова (Liquid Obsidian & Neon Glow)
- **Фоновий простір**: Глибокий обсидіановий градієнт (`#080A0F` вгорі до `#040507` внизу) з логарифмічною координатною сіткою частот та лінійними децибельними лініями (`rgba(255, 255, 255, 0.06)`).
- **Спектральні сплайни**:
  - Лінія основного треку: неоновий ціан (`#22D3EE`), товщина 2.0 pt.
  - Зовнішній неоновий ореол (Bloom): малюється через `SkMaskFilter::MakeBlur(kSolid, 2.5f)` товщиною 4.5 pt та альфа-каналом 35%.
  - Заповнення простору під кривою: вертикальний градієнт `SkGradientShader::MakeLinear` від `rgba(34, 211, 238, 0.22)` до `rgba(34, 211, 238, 0.00)` на нижній межі.
  - Фонові треки (Sidechain): малюються напівпрозорими кольорами інструментів (бочка — пурпурний `#F43F5E`, бас — бурштиновий `#F59E0B`).

### 2.2. Інтерактивні плаваючі вузли (Floating Band Nodes)
- **Контекстна взаємодія**:
  - Немає громіздких панелей ручок. Усі маніпуляції відбуваються прямо на графіку.
  - При наведенні курсору навколо вузла з'являється напівпрозорий ореол фокусу радіусом 14 px.
  - Центральне ядро вузла: 4.5 px суцільного кольору з білим контуром товщиною 1.5 px.
  - Підпис параметра: моноширинний напис над вузлом (`1.2 kHz · +3.4 dB · Q 1.4`).
- **Тактильна фізика FabFilter**:
  - `Drag X`: зміна частоти за логарифмічним законом ($20\text{ Hz} \dots 20\text{ kHz}$).
  - `Drag Y`: зміна посилення/рівня (лінійно $-90\text{ dB} \dots +12\text{ dB}$).
  - `Mouse Wheel`: динамічна зміна добротності (Q-factor / Bandwidth).
  - `Shift` + Drag: режим надточного підстроювання (fine adjustment, 0.1 dB / 1 Hz).
  - `Alt` / `Option` + Drag: блокування руху по осі частоти (рух тільки посиленням).
  - `Cmd` / `Ctrl` + Click: тимчасовий Solo-моніторинг смуги (band solo audition).
  - `Double Click`: миттєве скидання у вихідне положення (0 dB).

### 2.3. Зони колізій (Clash Hotspots)
- При спектральному накладанні двох інструментів (наприклад, низькі частоти бочки та басу) між сплайнами малюється вертикальний тепловий градієнт (Heatmap):
  - 40–70% накладання: м'який бурштиновий колір (`rgba(245, 158, 11, 0.25)`).
  - > 70% накладання: яскраво-малиновий спалах (`rgba(244, 63, 94, 0.40)`).
  - Плаваючий індикатор ступеня конфлікту та рекомендованої корекції (наприклад, `-3.2 dB @ 180 Hz`).

### 2.4. Майстер-вимірювач вихідного рівня (Right-side Strip)
- Вертикальні стерео стовпчики L / R з роздільною індикацією Peak (зовнішні) та RMS (внутрішні).
- Колір: смарагдовий (-60 до -18 dB) -> бурштиновий (-18 до -3 dB) -> червоний (-3 до 0 dB).
- Світлодіодний індикатор **CLIP** нагорі з фіксацією перевантаження вище 0 dBFS та скиданням кліком миші.
- Повзунок вихідного рівня з підтримкою drag, mouse wheel та скидання до 100% (0 dB) подвійним кліком.

---

## 3. МАТЕМАТИЧНИЙ АПАРАТ DSP ТА АЛГОРИТМИ СПЛАЙНІВ

### 3.1. Алгоритм монотонного кубічного сплайну (Steffen Monotone Spline)
*Чому саме він: Стандартний сплайн Catmull-Rom спричиняє паразитичні "горби" (overshoot) між точками однакової амплітуди. Монотонний сплайн Стеффена математично гарантує, що лінія спектру ніколи не перевищить реальні піки.*

Для масиву точок $(x_i, y_i)$:
1. Інтервали по осі X: $h_i = x_{i+1} - x_i$.
2. Січні нахили: $\Delta_i = (y_{i+1} - y_i) / h_i$.
3. Похідні у внутрішніх вузлах:
   $$d_i = \begin{cases} 
   0, & \text{якщо } \Delta_{i-1} \cdot \Delta_i \le 0 \\
   \text{sgn}(\Delta_{i-1}) \cdot \min\left(|p_i|, \; 2|\Delta_{i-1}|, \; 2|\Delta_i|\right), & \text{де } p_i = \frac{\Delta_{i-1} h_i + \Delta_i h_{i-1}}{h_{i-1} + h_i} 
   \end{cases}$$
4. Генерація кубічних контрольних точок Безьє для Skia `SkPath::cubicTo`:
   $$C_{1, i} = \left(x_i + \frac{h_i}{3}, \; y_i + \frac{d_i \cdot h_i}{3}\right)$$
   $$C_{2, i} = \left(x_{i+1} - \frac{h_i}{3}, \; y_{i+1} - \frac{d_{i+1} \cdot h_i}{3}\right)$$

### 3.2. Логарифмічні та амплітудні проекції координат
- **Частота $f \rightarrow$ Піксель $X$**:
  $$x(f) = X_{\text{offset}} + W \cdot \frac{\log_{10}(f / 20.0)}{\log_{10}(20000.0 / 20.0)}$$
- **Рівень $L_{\text{dB}} \rightarrow$ Піксель $Y$**:
  $$y(L) = Y_{\text{bottom}} - H \cdot \frac{L - (-90.0)}{12.0 - (-90.0)}$$

### 3.3. Шкала Барка (24 психоакустичні смуги)
Формула Цвікера (Zwicker):
$$z(f) = 13 \cdot \arctan(0.00076 \cdot f) + 3.5 \cdot \arctan\left(\left(\frac{f}{7500}\right)^2\right)$$
Енергія смуги інтегрується як сума амплітуд відповідних бінів 4096-точкового FFT.

### 3.4. Формула ступеня колізії (Clash Severity Formula)
Для амплітуд двох сигналів $A_1$ та $A_2$ у смузі Барка:
$$S_b = \frac{2 \cdot A_1 \cdot A_2}{A_1^2 + A_2^2} \cdot \max\left(0, 1 - \frac{|L_1 - L_2|}{18.0}\right)$$
Рекомендоване розділення еквалайзером:
$$\Delta \text{EQ} = -\left(1.5 + S_b \cdot 4.0\right)\text{ dB}$$

### 3.5. EBU R128 / ITU-R BS.1770-4 K-Weighting
Двоетапна фільтрація сигналу:
1. High-Shelf (+4 dB на 1.5 кГц) для моделювання акустичного впливу голови людини.
2. High-Pass RLB другого порядку (зріз нижче 38 Гц) для усунення нечутного інфразвуку.
3. Розрахунок інтегрованої гучності LUFS з двома порогами відсікання тиші (Gating: -70 LKFS абсолютний та -10 LU відносний).

---

## 4. СТРУКТУРИ ДАНИХ ТА НЕБЛОКУЮЧА ПАМ'ЯТЬ (C++20)

```cpp
#pragma once
#include <array>
#include <atomic>
#include <cstdint>
#include <cstring>

namespace LiquidSpectra {

constexpr size_t MAX_TRACKS = 32;
constexpr size_t BARK_BANDS = 24;

struct alignas(64) TrackSpectralFrame {
    int32_t instanceId { -1 };
    char trackName[32] { 0 };
    uint32_t colorArgb { 0xFF22D3EE };
    float barkLevels[BARK_BANDS] { 0.0f };
    float truePeakDb { -90.0f };
    float integratedLufs { -70.0f };
    std::atomic<uint64_t> writeEpoch { 0 };
};

class InterPluginSharedBus {
public:
    static InterPluginSharedBus& getInstance() noexcept {
        static InterPluginSharedBus instance;
        return instance;
    }

    void publish(int slot, const TrackSpectralFrame& frame) noexcept {
        if (slot < 0 || slot >= (int)MAX_TRACKS) return;
        auto& target = slots[slot];
        target.writeEpoch.fetch_add(1, std::memory_order_release);
        std::memcpy(&target, &frame, sizeof(TrackSpectralFrame));
        target.writeEpoch.fetch_add(1, std::memory_order_release);
    }

    bool snapshotSlot(int slot, TrackSpectralFrame& out) const noexcept {
        if (slot < 0 || slot >= (int)MAX_TRACKS) return false;
        const auto& target = slots[slot];
        uint64_t e1 = target.writeEpoch.load(std::memory_order_acquire);
        if (e1 & 1) return false;
        std::memcpy(&out, &target, sizeof(TrackSpectralFrame));
        uint64_t e2 = target.writeEpoch.load(std::memory_order_acquire);
        return (e1 == e2);
    }

private:
    std::array<TrackSpectralFrame, MAX_TRACKS> slots;
};

} // namespace LiquidSpectra
```

---

## 5. ПОКРОКОВИЙ ПРОМПТ ДЛЯ РОЗРОБКИ З НУЛЯ У GOOGLE FLOW

Скопіюйте цей промпт у Google Flow або AI Studio для створення коду з чистого аркуша:

```markdown
Створи з нуля C++20 VST3/AU аудіоплагін LiquidSpectra Pro за стандартами FabFilter Pro-Q 3 / Pro-L 2.

ОБОВ'ЯЗКОВІ ВИМОГИ:
1. Графіка: 100% чистий Skia C++ векторний рушій (SkCanvas, SkPath, SkPaint, Metal/Direct3D). ЖОДНОГО WebView або браузерних компонентів.
2. Візуальний стиль:
   - Обсидіановий фон (#080A0F -> #040507).
   - Неонові сплайни спектру з градієнтним спаданням під кривою.
   - Алгоритм монотонного кубічного сплайну Стеффена (Monotone Cubic Spline) для усунення паразитичних викидів (overshoot).
   - Інтерактивні плаваючі вузли (Floating Nodes) з підсвічуванням фокусу, керуванням Q-фактором коліщатком миші, Shift-точністю, Alt-блокуванням та Solo по Cmd/Ctrl.
   - Зони частотних колізій (Clash Hotspots) з індексацією ступеня маскування.
   - Правий майстер-індикатор вихідного рівня Peak/RMS із скиданням CLIP.
3. Аудіо DSP:
   - 4096-точковий FFT з розбиттям на 24 смуги Барка (Zwicker).
   - Неблокуюча міжінстансна шина (Lock-Free InterPluginSharedBus на std::atomic) до 32 доріжок DAW.
   - Вимірювання гучності EBU R128 / ITU-R BS.1770-4 K-weighting.
4. Збірка: CMake 3.22+ проект, сумісний із Windows 10/11 (MSVC x64) та macOS (Universal Binary ARM64 Apple Silicon M1-M4 + Intel).
```
