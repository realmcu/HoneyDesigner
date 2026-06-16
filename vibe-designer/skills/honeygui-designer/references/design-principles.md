# Embedded GUI Design Principles

Best practices for designing effective user interfaces for embedded devices, wearables, and IoT systems.

## Table of Contents

- [Core Principles](#core-principles)
  - [1. Simplicity First](#1-simplicity-first)
  - [2. Touch-Friendly Design](#2-touch-friendly-design)
  - [3. Readability](#3-readability)
  - [4. Visual Hierarchy](#4-visual-hierarchy)
  - [5. Feedback & Responsiveness](#5-feedback--responsiveness)
  - [6. Performance Optimization](#6-performance-optimization)
  - [7. Consistency](#7-consistency)
  - [8. Error Prevention & Recovery](#8-error-prevention--recovery)
  - [9. Accessibility](#9-accessibility)
  - [10. Context Awareness](#10-context-awareness)
- [Design Checklist](#design-checklist)
- [Color Guidelines](#color-guidelines)
- [Typography Guidelines](#typography-guidelines)
- [Animation Guidelines](#animation-guidelines)
- [Navigation Patterns](#navigation-patterns)
- [Platform-Specific Considerations](#platform-specific-considerations)
- [Testing & Validation](#testing--validation)
- [Resources for Inspiration](#resources-for-inspiration)
- [Summary: The 10 Commandments](#summary-the-10-commandments)

---

## Core Principles

### 1. **Simplicity First**

Embedded devices have limited screen real estate and processing power. Keep designs simple and focused.

**Guidelines**:
- One primary action per screen
- Maximum 3-4 secondary actions
- Avoid information overload
- Remove unnecessary elements

**Example**:
```
❌ Bad: 10 buttons on a smartwatch home screen
✅ Good: Time display + 2-3 quick action buttons
```

---

### 2. **Touch-Friendly Design**

Consider finger size and touch accuracy on small screens.

**Guidelines**:
- **Minimum touch target**: 44x44 pixels
- **Preferred size**: 60x60 pixels or larger
- **Spacing**: At least 8-16px between interactive elements
- **Edge avoidance**: Keep critical buttons away from screen edges

**Touch Target Sizes**:
```
Critical actions (confirm/delete): 60x60px or larger
Primary buttons: 50x50px minimum
Secondary buttons: 44x44px minimum
Icons/labels (non-interactive): Can be smaller
```

**Example Layout**:
```xml
<!-- Good spacing and sizes -->
<hg_button id="btn_1" x="50" y="200" width="80" height="80" />   <!-- 80x80, good -->
<hg_button id="btn_2" x="170" y="200" width="80" height="80" />  <!-- 40px gap, good -->
<hg_button id="btn_3" x="290" y="200" width="80" height="80" />

<!-- Avoid this -->
<hg_button id="btn_tiny" x="100" y="300" width="30" height="30" />  <!-- Too small! -->
<hg_button id="btn_close" x="135" y="300" width="40" height="40" /> <!-- Too close! -->
```

---

### 3. **Readability**

Text must be legible on small screens, often viewed in varying lighting conditions.

**Font Sizes**:
- **Minimum body text**: 16px
- **Titles/headers**: 24-32px
- **Large displays (time, metrics)**: 40-60px+
- **Small labels**: 12-14px (use sparingly)

**Contrast**:
- **High contrast**: Light text on dark background (or vice versa)
- **WCAG AA standard**: Contrast ratio ≥ 4.5:1 for normal text
- **Avoid**: Low-contrast color combinations (e.g., light gray on white)

**Font Weight**:
- Use bold for emphasis
- Regular weight for body text
- Avoid thin weights (hard to read on small screens)

**Example**:
```xml
<!-- Good readability -->
<hg_label id="lbl_title"
          text="Settings"
          fontSize="28"
          color="#FFFFFF"
          backgroundColor="#000000" />  <!-- High contrast -->

<!-- Poor readability -->
<hg_label id="lbl_subtitle"
          text="Subtitle"
          fontSize="10"           <!-- Too small -->
          color="#CCCCCC"
          backgroundColor="#DDDDDD" />  <!-- Low contrast -->
```

---

### 4. **Visual Hierarchy**

Guide user attention to the most important information first.

**Techniques**:
- **Size**: Larger = more important
- **Color**: Bright/saturated colors draw attention
- **Position**: Top-center is prime real estate
- **Contrast**: High contrast stands out
- **Whitespace**: Space around elements increases prominence

**Priority Levels**:
1. **Primary**: Main action or information (largest, brightest)
2. **Secondary**: Supporting actions (medium size, muted colors)
3. **Tertiary**: Optional info (smallest, lowest contrast)

**Example**:
```xml
<hg_view id="view_home" x="0" y="0" width="454" height="454">
  <!-- Primary: Large time display (top-center) -->
  <hg_label id="lbl_time"
            x="127" y="150" width="200" height="60"
            text="14:32"
            fontSize="48"
            color="#FFFFFF" />

  <!-- Secondary: Date (below, smaller) -->
  <hg_label id="lbl_date"
            x="127" y="220" width="200" height="30"
            text="Monday, Mar 18"
            fontSize="16"
            color="#CCCCCC" />

  <!-- Tertiary: Battery (corner, smallest) -->
  <hg_label id="lbl_battery"
            x="380" y="20" width="50" height="20"
            text="85%"
            fontSize="12"
            color="#999999" />
</hg_view>
```

---

### 5. **Feedback & Responsiveness**

Provide immediate visual feedback for all interactions.

**Feedback Methods**:
- **Button press**: Change color, show pressed state
- **State change**: Update icon/text immediately
- **Loading**: Show spinner or progress indicator
- **Success/error**: Brief visual confirmation

**Response Time**:
- **Instant**: < 100ms (feels immediate)
- **Fast**: 100-300ms (noticeable but acceptable)
- **Delayed**: > 300ms (needs loading indicator)

**Example**:
```xml
<!-- Image button: press feedback is built in (imageOn shown while pressed) -->
<hg_button id="btn_action"
           x="177" y="300" width="100" height="44"
           imageOn="/btn_pressed.bin" imageOff="/btn_normal.bin"
           clickCallback="on_action_click" />

<!-- Or an opacity pulse via the timers attribute (JSON; see HML-Spec.md §13) -->
<hg_image id="img_pulse" x="177" y="300" width="100" height="44" src="/btn_normal.bin"
          timers='[{"id":"t_pulse","enabled":true,"interval":16,"reload":true,"mode":"preset","segments":[{"duration":100,"actions":[{"type":"opacity","from":255,"to":180}]},{"duration":100,"actions":[{"type":"opacity","from":180,"to":255}]}]}]' />
```

---

### 6. **Performance Optimization**

Embedded devices have limited CPU and memory. Optimize for performance.

**Guidelines**:
- **Limit nesting**: Keep component hierarchy shallow (≤ 4-5 levels)
- **Reuse assets**: Share images/fonts across components
- **Optimize images**: Use appropriate resolutions, compress assets
- **Minimize animations**: Smooth but not excessive (60fps target)
- **Lazy loading**: Load heavy content only when needed

**Asset Optimization**:
- Use appropriate color depth (RGB565 vs ARGB8888)
- Resize images to actual display size
- Remove unused assets
- Consider binary format (.bin) for efficiency

**Example**:
```xml
<!-- Good: Shallow hierarchy, reused assets -->
<hg_view id="view_main" x="0" y="0" width="454" height="454">
  <hg_image id="img_bg" x="0" y="0" width="454" height="454" src="/bg.bin" />
  <hg_button id="btn_1" x="50" y="360" width="80" height="80" imageOff="/icon_generic.bin" />
  <hg_button id="btn_2" x="160" y="360" width="80" height="80" imageOff="/icon_generic.bin" />  <!-- Reused -->
</hg_view>

<!-- Avoid: Deep nesting -->
<hg_view id="view_1">
  <hg_view id="view_2">
    <hg_view id="view_3">
      <hg_view id="view_4">
        <hg_view id="view_5">  <!-- Too deep! -->
          <hg_button id="btn" />
        </hg_view>
      </hg_view>
    </hg_view>
  </hg_view>
</hg_view>
```

---

### 7. **Consistency**

Maintain consistent patterns across the interface.

**Consistency Areas**:
- **Layout**: Similar screens use similar structure
- **Navigation**: Predictable back/home actions
- **Colors**: Consistent color meanings (red = danger, green = success)
- **Icons**: Same icon for same action across screens
- **Spacing**: Consistent margins and padding

**Example**:
```
All settings screens:
- Header with back button (left) and title (center)
- Content area with scrollable list
- Standard item height (60-80px)
- Consistent padding (20px sides)
```

---

### 8. **Error Prevention & Recovery**

Design to prevent errors and provide clear recovery paths.

**Prevention**:
- **Confirmation dialogs**: For destructive actions (delete, reset)
- **Input validation**: Check values before submission
- **Disable invalid options**: Gray out unavailable actions
- **Clear labels**: Unambiguous button text

**Recovery**:
- **Undo functionality**: Allow reverting recent actions
- **Clear error messages**: Explain what went wrong
- **Suggested fixes**: Guide users to resolution

**Example**:
```xml
<!-- Confirmation dialog for delete -->
<hg_window id="win_confirm_delete"
           x="50" y="127" width="354" height="200"
           showBackground="true" backgroundColor="#1E1E1E">
  <hg_label id="lbl_title"
            x="27" y="20" width="300" height="30"
            text="Confirm Delete" fontSize="20" color="#FFFFFF"
            hAlign="CENTER" fontFile="/NotoSansSC-Bold.ttf" />
  <hg_label id="lbl_message"
            x="27" y="60" width="300" height="40"
            text="Delete this item? This cannot be undone."
            fontSize="16" color="#CCCCCC"
            hAlign="CENTER" fontFile="/NotoSansSC-Regular.ttf" />

  <!-- Image buttons; click handlers via clickCallback -->
  <hg_button id="btn_cancel"
             x="57" y="120" width="120" height="44"
             imageOn="/btn_cancel_on.bin" imageOff="/btn_cancel.bin"
             clickCallback="closeDialog" />
  <hg_button id="btn_confirm"
             x="197" y="120" width="120" height="44"
             imageOn="/btn_delete_on.bin" imageOff="/btn_delete.bin"
             clickCallback="confirmDelete" />
</hg_window>
```

---

### 9. **Accessibility**

Design for users with varying abilities.

**Guidelines**:
- **High contrast mode**: Ensure readability in high contrast
- **Larger text option**: Allow font size scaling
- **Haptic feedback**: Vibrations for important events (if supported)
- **Audio feedback**: Sounds for confirmations (if supported)
- **Simple language**: Clear, concise text

---

### 10. **Context Awareness**

Design for the usage context of embedded devices.

**Considerations**:

**Wearables (Smartwatch, Fitness Tracker)**:
- Glanceable information (< 5 second interaction)
- One-handed operation
- Frequently interrupted (notifications)
- Battery conservation critical

**IoT Panels (Thermostat, Smart Home)**:
- Infrequent use (easy to forget UI)
- Multiple users (clear, self-explanatory)
- Ambient display (visible from distance)
- Quick access to common tasks

**Industrial/Medical**:
- High reliability critical
- Clear error indication
- Precise data display
- Accessibility for gloves/harsh conditions

**Example - Smartwatch Design**:
```xml
<!-- Glanceable home screen -->
<hg_view id="view_home" x="0" y="0" width="454" height="454">
  <!-- Large time (primary info) -->
  <hg_label id="lbl_time"
            x="127" y="150" width="200" height="60"
            text="14:32"
            fontSize="48" />

  <!-- Quick metrics (secondary) -->
  <hg_label id="lbl_steps"
            x="177" y="220" width="100" height="30"
            text="5,240 steps"
            fontSize="14" />

  <!-- One-tap actions (bottom) -->
  <hg_button id="btn_start_workout"
             x="177" y="350" width="100" height="44"
             text="Start"
             fontSize="18" />
</hg_view>
```

---

## Design Checklist

Before finalizing a design, verify:

- [ ] All interactive elements are ≥ 44x44px
- [ ] Text is ≥ 16px (body) or ≥ 24px (titles)
- [ ] High contrast (WCAG AA: ≥ 4.5:1)
- [ ] Visual hierarchy is clear (primary, secondary, tertiary)
- [ ] Visual feedback for all interactions
- [ ] Component hierarchy ≤ 4-5 levels deep
- [ ] Assets optimized (size, format)
- [ ] Consistent patterns across screens
- [ ] Destructive actions have confirmation
- [ ] Navigation is intuitive (back, home)
- [ ] Design tested on target device resolution

---

## Color Guidelines

### Color Roles

**Background Colors**:
- Dark: `#000000`, `#1A1A1A`, `#2A2A2A` (common for OLED)
- Light: `#FFFFFF`, `#F5F5F5`, `#E0E0E0` (less common on wearables)

**Text Colors**:
- Primary: `#FFFFFF` (on dark) or `#000000` (on light)
- Secondary: `#CCCCCC` (on dark) or `#666666` (on light)
- Tertiary: `#999999` (on dark) or `#AAAAAA` (on light)

**Accent Colors** (use sparingly for emphasis):
- Success: `#00FF88`, `#00C853`
- Error: `#FF0066`, `#FF1744`
- Warning: `#FF8800`, `#FFA000`
- Info: `#6688FF`, `#2196F3`

**Example Palette**:
```
Background: #000000 (black)
Surface:    #1E1E1E (dark gray)
Primary:    #00FF88 (green)
Secondary:  #6688FF (blue)
Text:       #FFFFFF (white)
Text Muted: #999999 (gray)
Error:      #FF0066 (red)
```

---

## Typography Guidelines

### Font Selection

**Embedded Devices**:
- Use simple, legible sans-serif fonts
- Avoid decorative or script fonts
- Monospace for numeric data (time, metrics)

**Common Choices**:
- Roboto (Android standard)
- San Francisco (iOS/watchOS standard)
- Arial, Helvetica (fallbacks)
- Noto Sans (international support)

### Font Sizes Reference

| Element | Size (px) | Example |
|---------|-----------|---------|
| Hero (time, main metric) | 48-72 | `14:32` |
| Title / Header | 24-32 | `Settings` |
| Body Text | 16-18 | `Description text` |
| Small Label | 12-14 | `Last updated` |
| Button Text | 16-18 | `Confirm` |
| Input Text | 16 | User input |

---

## Animation Guidelines

### When to Animate

- **Transitions**: Screen changes, view switching
- **Feedback**: Button press, state change
- **Attention**: Notifications, alerts
- **Progress**: Loading, downloading

### When NOT to Animate

- **Static content**: Text, images that don't change
- **High-frequency updates**: Real-time data (smooth, not animated)
- **Critical info**: Emergency alerts (instant, not gradual)

### Animation Timing

| Type | Duration | Easing |
|------|----------|--------|
| Micro-interactions | 100-200ms | Ease-out |
| Transitions | 200-400ms | Ease-in-out |
| Loading indicators | Infinite loop | Linear |
| Attention grabbers | 300-500ms | Bounce/elastic |

**Example**:
```xml
<!-- Smooth fade transition via the timers attribute (JSON; see HML-Spec.md §13) -->
<hg_image id="img_fade" x="0" y="0" width="454" height="454" src="/panel.bin"
          timers='[{"id":"t_fade","enabled":true,"interval":16,"reload":false,"mode":"preset","segments":[{"duration":300,"actions":[{"type":"opacity","from":0,"to":255}]}]}]' />
```

---

## Navigation Patterns

### Common Patterns

**Flat Navigation** (best for 2-5 screens):
- All screens accessible from main menu
- No deep hierarchy
- Example: Home → Settings, Home → Apps

**Hierarchical** (for complex apps):
- Parent-child relationships
- Back button to return to parent
- Example: Home → Settings → Wi-Fi Settings

**Tab-Based** (for related content):
- Horizontal tabs at top or bottom
- Switch between views without hierarchy
- Example: Today | Week | Month

### Navigation Elements

**Back Button**:
- Position: Top-left corner
- Size: 40x40px minimum
- Icon: Left arrow or "< Back"

**Home Button**:
- Always accessible (swipe or hardware)
- Returns to main screen
- Clear state (close modals)

---

## Platform-Specific Considerations

### Circular Displays (Smartwatches)

- **Center important content**: Corners are cut off
- **Radial layouts**: Menus in circular arrangement
- **Rotary input**: Support crown/bezel navigation
- **Minimal text**: Prioritize icons and numbers

### Rectangular Displays

- **Grid layouts**: Align to rectangular grid
- **Standard patterns**: Rows, columns work naturally
- **More text**: Can fit longer labels

### Small Screens (< 1.5 inch)

- **Single task focus**: One thing at a time
- **Larger elements**: More generous sizing
- **Fewer options**: 2-3 actions per screen

### Medium Screens (1.5-3 inch)

- **Balanced approach**: Mix icons and text
- **More content**: Can show lists, forms
- **Scrolling**: Vertical scrolling works well

---

## Testing & Validation

### Test Checklist

1. **On-device testing**: Always test on actual hardware
2. **Different lighting**: Indoor, outdoor, bright, dark
3. **Motion**: Test while moving (wearables)
4. **Multiple users**: Different hand sizes, ages
5. **Battery impact**: Monitor power consumption
6. **Edge cases**: Minimum/maximum values, empty states

### Common Issues

- Text too small to read
- Buttons too close together (accidental taps)
- Poor contrast (invisible in sunlight)
- Animations too slow (feels laggy)
- Deep nesting (slow rendering)
- Missing feedback (did it work?)

---

## Resources for Inspiration

- **Apple Watch HIG**: watchOS design guidelines
- **Wear OS Guidelines**: Android wearable best practices
- **Material Design**: Google's design system
- **Dribbble / Behance**: Wearable UI examples

---

## Summary: The 10 Commandments

1. **Keep it simple** - One primary action per screen
2. **Make it touch-friendly** - 44x44px minimum
3. **Ensure readability** - 16px+ text, high contrast
4. **Create visual hierarchy** - Size, color, position
5. **Provide feedback** - Instant response to interactions
6. **Optimize performance** - Shallow hierarchy, efficient assets
7. **Be consistent** - Patterns, colors, spacing
8. **Prevent errors** - Validation, confirmation, undo
9. **Consider accessibility** - High contrast, clear language
10. **Know your context** - Design for actual usage scenarios
