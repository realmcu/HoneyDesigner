import React, { useState, useRef, useEffect } from 'react';
import { ComponentType, ComponentDefinition, PropertyDefinition } from '../types';
import { t } from '../i18n';
import { PARTICLE_EFFECT_TYPES } from '../constants/particleEffects';
import { useDesignerStore } from '../store';
import ComponentIcon, { ComponentIconName } from './icons/ComponentIcon';
import './ComponentLibrary.css';

interface ComponentLibraryProps {
  onComponentDragStart: (type: ComponentType) => void;
  onCreateComponent?: (type: ComponentType) => void;
}

/**
 * 高级应用控件配置
 * 定义哪些基础控件有对应的高级应用变体
 */
interface AdvancedVariant {
  type: ComponentType;
  label: string;
  icon: ComponentIconName;
  preset?: any; // 预设属性
}

const advancedVariants: Record<string, AdvancedVariant[]> = {
  'hg_label': [
    { type: 'hg_time_label', label: 'Time Label', icon: 'time-label' },
    { 
      type: 'hg_timer_label', 
      label: '计时标签', 
      icon: 'timer-label',
      preset: {
        text: '00:00:00',
        timerAutoStart: false
      }
    },
  ],
  'hg_rect': [
    { 
      type: 'hg_rect', 
      label: 'Dual-State Button', 
      icon: 'dual-state',
      preset: {
        buttonMode: 'dual-state',
        buttonStateOnColor: '#00FF00',
        buttonStateOffColor: '#FF0000'
      }
    },
    { 
      type: 'hg_rect', 
      label: 'Opacity Button', 
      icon: 'opacity',
      preset: {
        buttonMode: 'opacity',
        buttonPressedOpacity: 128,
        buttonReleasedOpacity: 255
      }
    },
  ],
  'hg_circle': [
    { 
      type: 'hg_circle', 
      label: 'Dual-State Button', 
      icon: 'dual-state',
      preset: {
        buttonMode: 'dual-state',
        buttonStateOnColor: '#00FF00',
        buttonStateOffColor: '#FF0000'
      }
    },
    { 
      type: 'hg_circle', 
      label: 'Opacity Button', 
      icon: 'opacity',
      preset: {
        buttonMode: 'opacity',
        buttonPressedOpacity: 128,
        buttonReleasedOpacity: 255
      }
    },
  ],
};

/**
 * 右键菜单状态
 */
interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  componentType: string;
}

/**
 * Common text properties for components that display text.
 * Use spread syntax to mix into component definitions.
 * Override defaultValue for 'text' per component as needed.
 */
const TEXT_PROPERTIES: PropertyDefinition[] = [
  { name: 'text', label: 'Display Text', type: 'string', defaultValue: '', group: 'data' },
  { name: 'color', label: 'Color', type: 'color', defaultValue: '#ffffff', group: 'style' },
  { name: 'fontFile', label: 'Font File', type: 'string', defaultValue: '', group: 'font' },
  { name: 'fontSize', label: 'Font Size', type: 'number', defaultValue: 16, group: 'font' },
  { name: 'fontType', label: 'Font Type', type: 'select', defaultValue: 'bitmap',
    options: ['bitmap', 'vector'], group: 'font' },
  { name: 'renderMode', label: 'Render Mode', type: 'select', defaultValue: '4',
    options: ['1', '2', '4', '8'], group: 'font' },
];

/** Helper: create TEXT_PROPERTIES with a custom default text value */
const textProps = (defaultText: string): PropertyDefinition[] =>
  TEXT_PROPERTIES.map(p => p.name === 'text' ? { ...p, defaultValue: defaultText } : p) as PropertyDefinition[];

const componentDefinitions: ComponentDefinition[] = [
  {
    type: 'hg_button',
    name: 'Button',
    icon: 'button',
    defaultSize: { width: 100, height: 32 },
    properties: [
      ...textProps('Button'),
      { name: 'toggleMode', label: 'Toggle Mode', type: 'boolean', defaultValue: false, group: 'data' },
      { name: 'imageOn', label: 'On Image', type: 'string', group: 'data' },
      { name: 'imageOff', label: 'Off Image', type: 'string', group: 'data' },
      { name: 'clickCallback', label: 'Click Callback', type: 'string', defaultValue: '', group: 'data' },
      { name: 'initialState', label: 'Initial State', type: 'select', defaultValue: 'off', 
        options: ['on', 'off'], group: 'data' },
      { name: 'onCallback', label: 'On State Callback', type: 'string', defaultValue: '', group: 'data' },
      { name: 'offCallback', label: 'Off State Callback', type: 'string', defaultValue: '', group: 'data' },
      { name: 'controlTarget', label: 'Control Target', type: 'string', defaultValue: '', group: 'data' },
    ],
  },
  {
    type: 'hg_label',
    name: 'Label/Text',
    icon: 'label',
    defaultSize: { width: 100, height: 24 },
    properties: [
      { name: 'text', label: 'Display Text', type: 'string', defaultValue: 'Label', group: 'data' },
      { name: 'i18nKey', label: 'Localized Key', type: 'string', defaultValue: '', group: 'data' },
      { name: 'hAlign', label: 'Horizontal Align', type: 'select', defaultValue: 'LEFT', 
        options: ['LEFT', 'CENTER', 'RIGHT'], group: 'style' },
      { name: 'vAlign', label: 'Vertical Align', type: 'select', defaultValue: 'TOP', 
        options: ['TOP', 'MID'], group: 'style' },
      { name: 'color', label: 'Color', type: 'color', defaultValue: '#ffffff', group: 'style' },
      { name: 'letterSpacing', label: 'Letter Spacing', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'lineSpacing', label: 'Line Spacing', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'wordWrap', label: 'Word Wrap', type: 'boolean', defaultValue: false, group: 'style' },
      { name: 'wordBreak', label: 'Word Break', type: 'boolean', defaultValue: false, group: 'style' },
      { name: 'scrollDirection', label: 'Scroll Direction', type: 'select', defaultValue: 'horizontal', 
        options: ['horizontal', 'vertical'], group: 'scroll' },
      { name: 'scrollReverse', label: 'Reverse Direction', type: 'boolean', defaultValue: false, group: 'scroll' },
      { name: 'scrollStartOffset', label: 'Start Offset (px)', type: 'number', defaultValue: 0, group: 'scroll' },
      { name: 'scrollEndOffset', label: 'End Offset (px)', type: 'number', defaultValue: 0, group: 'scroll' },
      { name: 'scrollInterval', label: 'Loop Interval (ms)', type: 'number', defaultValue: 3000, group: 'scroll' },
      { name: 'scrollDuration', label: 'Total Duration (ms)', type: 'number', defaultValue: 0, group: 'scroll' },
      { name: 'fontFile', label: 'Font File', type: 'string', defaultValue: '', group: 'font' },
      { name: 'fontSize', label: 'Font Size', type: 'number', defaultValue: 16, group: 'font' },
      { name: 'fontType', label: 'Font Type', type: 'select', defaultValue: 'bitmap', 
        options: ['bitmap', 'vector'], group: 'font' },
      { name: 'renderMode', label: 'Render Mode', type: 'select', defaultValue: '4', 
        options: ['1', '2', '4', '8'], group: 'font' },
    ],
  },
  // hg_time_label 定义保留用于属性面板，但不在组件库中显示
  {
    type: 'hg_time_label',
    name: 'Time Label',
    icon: 'time-label',
    defaultSize: { width: 120, height: 24 },
    properties: [
      { name: 'text', label: 'Display Text', type: 'string', defaultValue: '', group: 'data' },
      { name: 'timeFormat', label: 'Time Format', type: 'select', defaultValue: 'HH:mm:ss', 
        options: ['HH:mm:ss', 'HH:mm', 'HH', 'mm', 'HH:mm-split', 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss', 'MM-DD HH:mm'], group: 'time' },
      { name: 'hAlign', label: 'Horizontal Align', type: 'select', defaultValue: 'LEFT', 
        options: ['LEFT', 'CENTER', 'RIGHT'], group: 'style' },
      { name: 'vAlign', label: 'Vertical Align', type: 'select', defaultValue: 'TOP', 
        options: ['TOP', 'MID'], group: 'style' },
      { name: 'color', label: 'Color', type: 'color', defaultValue: '#ffffff', group: 'style' },
      { name: 'letterSpacing', label: 'Letter Spacing', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'lineSpacing', label: 'Line Spacing', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'wordWrap', label: 'Word Wrap', type: 'boolean', defaultValue: false, group: 'style' },
      { name: 'fontFile', label: 'Font File', type: 'string', defaultValue: '', group: 'font' },
      { name: 'fontSize', label: 'Font Size', type: 'number', defaultValue: 16, group: 'font' },
      { name: 'fontType', label: 'Font Type', type: 'select', defaultValue: 'bitmap', 
        options: ['bitmap', 'vector'], group: 'font' },
      { name: 'renderMode', label: 'Render Mode', type: 'select', defaultValue: '4', 
        options: ['1', '2', '4', '8'], group: 'font' },
    ],
  },
  // hg_timer_label 定义保留用于属性面板，但不在组件库中显示
  {
    type: 'hg_timer_label',
    name: 'Timer Label',
    icon: 'timer-label',
    defaultSize: { width: 120, height: 24 },
    properties: [
      { name: 'text', label: 'Display Text', type: 'string', defaultValue: '00:00:00', group: 'data' },
      { name: 'timerType', label: 'Timer Type', type: 'select', defaultValue: 'stopwatch', 
        options: ['stopwatch', 'countdown'], group: 'timer' },
      { name: 'timerInitialValue', label: 'Initial Value (ms)', type: 'number', defaultValue: 0, group: 'timer' },
      { name: 'timerFormat', label: 'Display Format', type: 'select', defaultValue: 'HH:MM:SS', 
        options: ['HH:MM:SS', 'MM:SS', 'MM:SS:MS', 'SS'], group: 'timer' },
      { name: 'timerAutoStart', label: 'Auto Start', type: 'boolean', defaultValue: false, group: 'timer' },
      { name: 'hAlign', label: 'Horizontal Align', type: 'select', defaultValue: 'LEFT', 
        options: ['LEFT', 'CENTER', 'RIGHT'], group: 'style' },
      { name: 'vAlign', label: 'Vertical Align', type: 'select', defaultValue: 'TOP', 
        options: ['TOP', 'MID'], group: 'style' },
      { name: 'color', label: 'Color', type: 'color', defaultValue: '#ffffff', group: 'style' },
      { name: 'letterSpacing', label: 'Letter Spacing', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'lineSpacing', label: 'Line Spacing', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'wordWrap', label: 'Word Wrap', type: 'boolean', defaultValue: false, group: 'style' },
      { name: 'fontFile', label: 'Font File', type: 'string', defaultValue: '', group: 'font' },
      { name: 'fontSize', label: 'Font Size', type: 'number', defaultValue: 16, group: 'font' },
      { name: 'fontType', label: 'Font Type', type: 'select', defaultValue: 'bitmap', 
        options: ['bitmap', 'vector'], group: 'font' },
      { name: 'renderMode', label: 'Render Mode', type: 'select', defaultValue: '4', 
        options: ['1', '2', '4', '8'], group: 'font' },
    ],
  },
  {
    type: 'hg_input',
    name: 'Input',
    icon: 'input',
    engineSupport: { honeygui: 'unsupported' },
    defaultSize: { width: 200, height: 32 },
    properties: [
      { name: 'placeholder', label: 'Placeholder', type: 'string', group: 'data' },
    ],
  },
  {
    type: 'hg_image',
    name: 'Image',
    icon: 'image',
    defaultSize: { width: 150, height: 150 },
    properties: [
      { name: 'src', label: 'Image Path', type: 'string', group: 'data' },
      { name: 'visible', label: 'Visible', type: 'boolean', defaultValue: true, group: 'general' },
    ],
  },
  {
    type: 'hg_checkbox',
    name: 'Checkbox',
    icon: 'checkbox',
    engineSupport: { honeygui: 'unsupported', lvgl: 'ready' },
    defaultSize: { width: 120, height: 24 },
    properties: [
      ...textProps('Checkbox'),
      { name: 'value', label: 'Checked', type: 'boolean', defaultValue: false, group: 'data' },
    ],
  },
  {
    type: 'hg_radio',
    name: 'Radio',
    icon: 'radio',
    engineSupport: { honeygui: 'unsupported', lvgl: 'ready' },
    defaultSize: { width: 120, height: 24 },
    properties: [
      ...textProps('Option'),
      { name: 'value', label: 'Checked', type: 'boolean', defaultValue: false, group: 'data' },
    ],
  },
  {
    type: 'hg_switch',
    name: 'Switch',
    icon: 'switch',
    engineSupport: { honeygui: 'unsupported', lvgl: 'ready' },
    defaultSize: { width: 50, height: 28 },
    properties: [
      { name: 'value', label: 'Checked', type: 'boolean', defaultValue: false, group: 'data' },
    ],
  },
  {
    type: 'hg_progressbar',
    name: 'Progress Bar',
    icon: 'progressbar',
    engineSupport: { honeygui: 'unsupported', lvgl: 'ready' },
    defaultSize: { width: 200, height: 20 },
    properties: [
      { name: 'value', label: 'Value', type: 'number', defaultValue: 0, group: 'data' },
      { name: 'min', label: 'Min', type: 'number', defaultValue: 0, group: 'data' },
      { name: 'max', label: 'Max', type: 'number', defaultValue: 100, group: 'data' },
      { name: 'color', label: 'Bar Color', type: 'color', defaultValue: '#00FF00', group: 'style' },
      { name: 'backgroundColor', label: 'Track Color', type: 'color', defaultValue: '#333333', group: 'style' },
      { name: 'orientation', label: 'Orientation', type: 'select', defaultValue: 'horizontal', options: ['horizontal', 'vertical'], group: 'style' },
    ],
  },
  {
    type: 'hg_slider',
    name: 'Slider',
    icon: 'slider',
    engineSupport: { honeygui: 'unsupported', lvgl: 'ready' },
    defaultSize: { width: 200, height: 20 },
    properties: [
      { name: 'value', label: 'Value', type: 'number', defaultValue: 0, group: 'data' },
      { name: 'min', label: 'Min', type: 'number', defaultValue: 0, group: 'data' },
      { name: 'max', label: 'Max', type: 'number', defaultValue: 100, group: 'data' },
    ],
  },
  {
    type: 'hg_view',
    name: 'View',
    icon: 'view',
    defaultSize: { width: 350, height: 250 },
    properties: [
      { name: 'entry', label: 'Entry View', type: 'boolean', defaultValue: false, group: 'general' },
      { name: 'backgroundColor', label: 'Background Color', type: 'color', defaultValue: '#000000', group: 'style', hint: 'Designer only - helps identify container boundaries' },
      { name: 'borderRadius', label: 'Border Radius', type: 'number', defaultValue: 20, group: 'style' },
      { name: 'padding', label: 'Padding', type: 'number', defaultValue: 12, group: 'style' },
      { name: 'overflow', label: 'Overflow', type: 'select', defaultValue: 'auto', options: ['auto', 'hidden', 'scroll'], group: 'style' },
    ],
  },
  {
    type: 'hg_window',
    name: 'Window',
    icon: 'window',
    defaultSize: { width: 450, height: 350 },
    properties: [
      { name: 'showBackground', label: 'Show Background', type: 'boolean', defaultValue: false, group: 'style' },
      { name: 'backgroundColor', label: 'Background Color', type: 'color', defaultValue: '#808080', group: 'style', hint: 'Designer only - helps identify container boundaries' },
      { name: 'enableBlur', label: 'Enable Blur', type: 'boolean', defaultValue: false, group: 'general' },
      { name: 'blurDegree', label: 'Blur Degree', type: 'number', defaultValue: 225, group: 'general' },
    ],
  },
  {
    type: 'hg_canvas',
    name: 'Canvas',
    icon: 'canvas',
    engineSupport: { honeygui: 'unsupported', lvgl: 'unsupported' },
    defaultSize: { width: 300, height: 200 },
    properties: [
      { name: 'backgroundColor', label: 'Background Color', type: 'color', defaultValue: '#ffffff', group: 'style', hint: 'Designer only - helps identify container boundaries' },
      { name: 'border', label: 'Border', type: 'string', defaultValue: '1px solid #cccccc', group: 'style' },
      { name: 'borderRadius', label: 'Border Radius', type: 'number', defaultValue: 4, group: 'style' },
      { name: 'overflow', label: 'Overflow', type: 'select', defaultValue: 'hidden', options: ['hidden', 'auto', 'scroll', 'visible'], group: 'style' },
    ],
  },
  {
    type: 'hg_list',
    name: 'List',
    icon: 'list',
    defaultSize: { width: 300, height: 400 },
    properties: [
      { name: 'itemWidth', label: 'Item Width', type: 'number', defaultValue: 100, group: 'style' },
      { name: 'itemHeight', label: 'Item Height', type: 'number', defaultValue: 100, group: 'style' },
      { name: 'space', label: 'Item Spacing', type: 'number', defaultValue: 5, group: 'style' },
      { name: 'direction', label: 'Direction', type: 'select', defaultValue: 'VERTICAL', options: ['VERTICAL', 'HORIZONTAL'], group: 'style' },
      { name: 'style', label: 'Style', type: 'select', defaultValue: 'LIST_CLASSIC', options: ['LIST_CLASSIC', 'LIST_CIRCLE', 'LIST_ZOOM', 'LIST_CARD', 'LIST_FADE', 'LIST_FAN', 'LIST_HELIX', 'LIST_CURL'], group: 'style' },
      { name: 'cardStackLocation', label: 'Stack Location Distance', type: 'number', defaultValue: 0, group: 'style' },
      // circleRadius 默认值为 undefined，运行时根据 list 的宽高和方向计算
      { name: 'circleRadius', label: 'Circle Radius', type: 'number', group: 'style' },
      { name: 'noteNum', label: 'Item Count', type: 'number', defaultValue: 5, group: 'data' },
      { name: 'autoAlign', label: 'Auto Align', type: 'boolean', defaultValue: true, group: 'general' },
      { name: 'inertia', label: 'Inertia Scroll', type: 'boolean', defaultValue: true, group: 'general' },
      { name: 'loop', label: 'Loop Scroll', type: 'boolean', defaultValue: false, group: 'general' },
      { name: 'createBar', label: 'Show Scrollbar', type: 'boolean', defaultValue: false, group: 'general' },
      { name: 'enableAreaDisplay', label: 'Enable Area Display', type: 'boolean', defaultValue: false, group: 'general' },
      { name: 'keepNoteAlive', label: 'Keep Note Alive', type: 'boolean', defaultValue: false, group: 'general' },
      { name: 'offset', label: 'Initial Offset', type: 'number', defaultValue: 0, group: 'data' },
      { name: 'outScope', label: 'Out of Scope', type: 'number', defaultValue: 0, group: 'data' },
    ],
  },
  {
    type: 'hg_video',
    name: 'Video',
    icon: 'video',
    engineSupport: { lvgl: 'unsupported' },
    defaultSize: { width: 320, height: 240 },
    properties: [
      { name: 'src', label: 'Video Path', type: 'string', group: 'data' },
      { name: 'autoPlay', label: 'Autoplay', type: 'boolean', defaultValue: true, group: 'general' },
      { name: 'loop', label: 'Loop', type: 'boolean', defaultValue: false, group: 'general' },
    ],
  },
  {
    type: 'hg_streaming',
    name: 'Streaming',
    icon: 'streaming',
    engineSupport: { lvgl: 'unsupported' },
    defaultSize: { width: 320, height: 240 },
    properties: [
      { name: 'codec',          label: 'Codec',                    type: 'select', defaultValue: 'jpeg',  options: ['jpeg', 'msv1', 'raw', 'h264'], group: 'data' },
      { name: 'transporter',    label: 'Transporter Variable',     type: 'string', group: 'data' },
      { name: 'updateInterval', label: 'Update Interval (ms)',     type: 'number', defaultValue: 40,      min: 10, max: 5000, group: 'data' },
      { name: 'dropMode',       label: 'Drop Mode',                type: 'select', defaultValue: 'none',  options: ['none', 'unconditional'], group: 'data' },
    ],
  },
  {
    type: 'hg_gif',
    name: 'GIF Animation',
    icon: 'gif',
    engineSupport: { lvgl: 'ready' },
    defaultSize: { width: 150, height: 150 },
    properties: [
      { name: 'src', label: 'GIF Path', type: 'string', group: 'data' },
      { name: 'visible', label: 'Visible', type: 'boolean', defaultValue: true, group: 'general' },
      { name: 'highQuality', label: 'High Quality', type: 'boolean', defaultValue: false, group: 'general' },
    ],
  },
  {
    type: 'hg_3d',
    name: '3D Model',
    icon: 'model-3d',
    engineSupport: { lvgl: 'unsupported' },
    defaultSize: { width: 400, height: 400 },
    properties: [
      { name: 'modelPath', label: 'Model Path', type: 'string', group: 'data' },
      { name: 'drawType', label: 'Draw Type', type: 'select', defaultValue: 'L3_DRAW_FRONT_AND_SORT', options: ['L3_DRAW_FRONT_ONLY', 'L3_DRAW_FRONT_AND_BACK', 'L3_DRAW_FRONT_AND_SORT'], group: 'data' },
      { name: 'worldX', label: 'World X', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'worldY', label: 'World Y', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'worldZ', label: 'World Z', type: 'number', defaultValue: 30, group: 'style' },
      { name: 'rotationX', label: 'Rotation X', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'rotationY', label: 'Rotation Y', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'rotationZ', label: 'Rotation Z', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'scale', label: 'Scale', type: 'number', defaultValue: 5, group: 'style' },
      { name: 'cameraPosX', label: 'Camera X', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'cameraPosY', label: 'Camera Y', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'cameraPosZ', label: 'Camera Z', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'cameraLookX', label: 'Look At X', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'cameraLookY', label: 'Look At Y', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'cameraLookZ', label: 'Look At Z', type: 'number', defaultValue: 1, group: 'style' },
    ],
  },
  {
    type: 'hg_arc',
    name: 'Arc',
    icon: 'arc',
    defaultSize: { width: 96, height: 96 },
    properties: [
      { name: 'radius', label: 'Radius', type: 'number', defaultValue: 40, min: 0, group: 'style' },
      { name: 'startAngle', label: 'Start Angle', type: 'number', defaultValue: 0, group: 'style' },
      { name: 'endAngle', label: 'End Angle', type: 'number', defaultValue: 270, group: 'style' },
      { name: 'strokeWidth', label: 'Stroke Width', type: 'number', defaultValue: 8, min: 0, group: 'style' },
      { name: 'color', label: 'Color', type: 'color', defaultValue: '#007acc', group: 'style' },
      { name: 'opacity', label: 'Opacity', type: 'number', defaultValue: 255, min: 0, max: 255, group: 'style' },
      { name: 'useGradient', label: 'Enable Gradient', type: 'boolean', defaultValue: false, group: 'style' },
      { name: 'arcGroup', label: 'Arc Group', type: 'string', defaultValue: '', group: 'general' },
    ],
  },
  {
    type: 'hg_circle',
    name: 'Circle',
    icon: 'circle',
    defaultSize: { width: 80, height: 80 },
    properties: [
      { name: 'radius', label: 'Radius', type: 'number', defaultValue: 40, min: 0, group: 'style' },
      { name: 'fillColor', label: 'Fill Color', type: 'color', defaultValue: '#007acc', group: 'style' },
      { name: 'opacity', label: 'Opacity (0-255)', type: 'number', defaultValue: 255, min: 0, max: 255, group: 'style' },
      { name: 'useGradient', label: 'Enable Gradient', type: 'boolean', defaultValue: false, group: 'style' },
      { name: 'gradientType', label: 'Gradient Type', type: 'select', defaultValue: 'radial', options: ['radial', 'angular'], group: 'style' },
      // 按键效果属性
      { name: 'buttonMode', label: 'Button Mode', type: 'select', defaultValue: 'none', 
        options: ['none', 'dual-state', 'opacity'], group: 'interaction' },
      { name: 'buttonStateOnColor', label: 'On State Color', type: 'color', defaultValue: '#00FF00', group: 'interaction' },
      { name: 'buttonStateOffColor', label: 'Off State Color', type: 'color', defaultValue: '#FF0000', group: 'interaction' },
      { name: 'buttonInitialState', label: 'Initial State', type: 'select', defaultValue: 'off', 
        options: ['on', 'off'], group: 'interaction' },
      { name: 'buttonPressedOpacity', label: 'Pressed Opacity', type: 'number', defaultValue: 128, min: 0, max: 255, group: 'interaction' },
      { name: 'buttonReleasedOpacity', label: 'Released Opacity', type: 'number', defaultValue: 255, min: 0, max: 255, group: 'interaction' },
    ],
  },
  {
    type: 'hg_rect',
    name: 'Rectangle',
    icon: 'rect',
    defaultSize: { width: 120, height: 80 },
    properties: [
      { name: 'borderRadius', label: 'Border Radius', type: 'number', defaultValue: 0, min: 0, group: 'style' },
      { name: 'fillColor', label: 'Fill Color', type: 'color', defaultValue: '#007acc', group: 'style' },
      { name: 'opacity', label: 'Opacity', type: 'number', defaultValue: 255, min: 0, max: 255, group: 'style' },
      { name: 'useGradient', label: 'Enable Gradient', type: 'boolean', defaultValue: false, group: 'style' },
      { name: 'gradientDirection', label: 'Gradient Direction', type: 'select', defaultValue: 'horizontal', options: ['horizontal', 'vertical', 'diagonal_tl_br', 'diagonal_tr_bl'], group: 'style' },
      // 按键效果属性
      { name: 'buttonMode', label: 'Button Mode', type: 'select', defaultValue: 'none', 
        options: ['none', 'dual-state', 'opacity'], group: 'interaction' },
      { name: 'buttonStateOnColor', label: 'On State Color', type: 'color', defaultValue: '#00FF00', group: 'interaction' },
      { name: 'buttonStateOffColor', label: 'Off State Color', type: 'color', defaultValue: '#FF0000', group: 'interaction' },
      { name: 'buttonInitialState', label: 'Initial State', type: 'select', defaultValue: 'off', 
        options: ['on', 'off'], group: 'interaction' },
      { name: 'buttonPressedOpacity', label: 'Pressed Opacity', type: 'number', defaultValue: 128, min: 0, max: 255, group: 'interaction' },
      { name: 'buttonReleasedOpacity', label: 'Released Opacity', type: 'number', defaultValue: 255, min: 0, max: 255, group: 'interaction' },
    ],
  },
  {
    type: 'hg_svg',
    name: 'SVG',
    icon: 'svg',
    engineSupport: { lvgl: 'ready' },
    defaultSize: { width: 100, height: 100 },
    properties: [
      { name: 'src', label: 'SVG Path', type: 'string', group: 'data' },
    ],
  },
  {
    type: 'hg_lottie',
    name: 'Lottie Animation',
    icon: 'lottie',
    engineSupport: { lvgl: 'ready' },
    defaultSize: { width: 150, height: 150 },
    properties: [
      { name: 'src', label: 'Animation Path', type: 'string', group: 'data' },
      { name: 'autoplay', label: 'Autoplay', type: 'boolean', defaultValue: true, group: 'general' },
      { name: 'loop', label: 'Loop', type: 'boolean', defaultValue: true, group: 'general' },
    ],
  },
  {
    type: 'hg_glass',
    name: 'Glass Effect',
    icon: 'glass',
    engineSupport: { lvgl: 'unsupported' },
    defaultSize: { width: 150, height: 150 },
    properties: [
      { name: 'src', label: 'Shape Path', type: 'string', group: 'data' },
      { name: 'distortion', label: 'Distortion (%)', type: 'number', defaultValue: 10, group: 'data' },
      { name: 'region', label: 'Effect Range (%)', type: 'number', defaultValue: 50, group: 'data' },
      { name: 'movable', label: 'Movable', type: 'boolean', defaultValue: false, group: 'interaction' },
      { name: 'click', label: 'Click', type: 'boolean', defaultValue: false, group: 'interaction' },
    ],
  },
  {
    type: 'hg_particle',
    name: 'Particle Effect',
    icon: 'particle',
    engineSupport: { lvgl: 'unsupported' },
    defaultSize: { width: 200, height: 200 },
    properties: [
      {
        name: 'particleEffect',
        label: 'Effect Type',
        type: 'select',
        defaultValue: 'snow',
        options: PARTICLE_EFFECT_TYPES,
        group: 'data'
      },
    ],
  },
  {
    type: 'hg_menu_cellular',
    name: 'Menu Cellular',
    icon: 'menu-cellular',
    engineSupport: { lvgl: 'unsupported' },
    defaultSize: { width: 0, height: 0 }, // 创建时动态设置为项目分辨率
    properties: [
      { name: 'iconFolder', label: 'Icon Folder', type: 'string', defaultValue: '', group: 'data' },
      { name: 'iconSize',   label: 'Icon Size',   type: 'number', defaultValue: 64,  group: 'data' },
      { name: 'offsetX',    label: 'Offset X',    type: 'number', defaultValue: 0,   group: 'data' },
      { name: 'offsetY',    label: 'Offset Y',    type: 'number', defaultValue: 0,   group: 'data' },
    ],
  },
  {
    type: 'hg_qbcode',
    name: 'QR/Barcode',
    icon: 'qrcode',
    engineSupport: { lvgl: 'ready' },
    defaultSize: { width: 200, height: 200 },
    properties: [
      { name: 'codeType',    label: 'Code Type',    type: 'select', defaultValue: 'qrcode',  options: ['qrcode', 'barcode'], group: 'data' },
      { name: 'displayMode', label: 'Display Mode', type: 'select', defaultValue: 'section', options: ['section', 'image'],   group: 'data' },
      { name: 'encodeMode',  label: 'Encode Mode',  type: 'select', defaultValue: 'text',    options: ['text', 'binary'],    group: 'data' },
      { name: 'codeContent', label: 'Code Content', type: 'string', defaultValue: 'Hello, World!', group: 'data' },
      { name: 'borderSize',  label: 'Border Size',  type: 'number', defaultValue: 2, min: 0, max: 32, group: 'data' },
    ],
  },
];

// Component categories - hg_time_label 不在组件库中直接显示，只能通过右键标签控件创建
const componentCategories = [
  { name: 'Containers', types: ['hg_view', 'hg_window', 'hg_canvas', 'hg_list', 'hg_menu_cellular'] },
  { name: 'Basic Controls', types: ['hg_button', 'hg_label', 'hg_image'] },
  { name: 'Input Controls', types: ['hg_input', 'hg_checkbox', 'hg_radio', 'hg_switch', 'hg_slider', 'hg_progressbar'] },
  { name: 'Graphics', types: ['hg_arc', 'hg_circle', 'hg_rect', 'hg_svg', 'hg_glass', 'hg_particle', 'hg_qbcode'] },
  { name: 'Multimedia', types: ['hg_video', 'hg_streaming', 'hg_gif', 'hg_3d', 'hg_lottie'] },
];

/**
 * 组件图标映射表
 * 用于在组件树和其他地方显示统一的组件图标
 */
const componentIconMap: Record<string, ComponentIconName> = componentDefinitions.reduce((acc, def) => {
  acc[def.type] = def.icon;
  return acc;
}, {} as Record<string, ComponentIconName>);

// 添加不在组件库中显示但需要图标的组件
componentIconMap['hg_list_item'] = 'list-item';

const ComponentLibrary: React.FC<ComponentLibraryProps> = ({ onComponentDragStart, onCreateComponent }) => {
  const projectConfig = useDesignerStore(state => state.projectConfig);
  const targetEngine = projectConfig?.targetEngine || 'honeygui';
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(componentCategories.map(c => c.name))
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    componentType: '',
  });
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(prev => ({ ...prev, visible: false }));
      }
    };
    if (contextMenu.visible) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu.visible]);

  const handleDragStart = (e: React.DragEvent, type: ComponentType) => {
    e.dataTransfer.setData('component-type', type);
    onComponentDragStart(type);
  };

  const handleContextMenu = (e: React.MouseEvent, componentType: string) => {
    // 只有有高级变体的组件才显示右键菜单
    if (!advancedVariants[componentType]) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      componentType,
    });
  };

  const handleVariantClick = (variant: AdvancedVariant) => {
    // 直接在当前 view 中创建组件，并应用预设属性
    if (onCreateComponent) {
      // 如果有预设属性，直接在前端创建组件并应用预设
      if (variant.preset) {
        // 触发创建组件，并通过自定义事件传递预设属性
        const event = new CustomEvent('createComponentWithPreset', {
          detail: {
            componentType: variant.type,
            preset: variant.preset
          }
        });
        window.dispatchEvent(event);
      } else {
        onCreateComponent(variant.type);
      }
    }
    setContextMenu(prev => ({ ...prev, visible: false }));
  };

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  };

  const variants = advancedVariants[contextMenu.componentType] || [];

  return (
    <div className="component-library">
      <div className="library-content">
        {componentCategories.map((category) => {
          const isExpanded = expandedCategories.has(category.name);
          const components = componentDefinitions.filter(c =>
            category.types.includes(c.type) &&
            (c.engineSupport?.[targetEngine] ?? 'ready') === 'ready'
          );

          if (components.length === 0) return null;

          return (
            <div key={category.name} className="component-category">
              <div 
                className="category-header" 
                onClick={() => toggleCategory(category.name)}
              >
                <span className={`expand-icon ${isExpanded ? 'expanded' : ''}`}>▶</span>
                <span className="category-name">{t(category.name as any)}</span>
              </div>
              {isExpanded && (
                <div className="category-content">
                  {components.map((component) => (
                    <div
                      key={component.type}
                      className="component-item"
                      draggable
                      onDragStart={(e) => handleDragStart(e, component.type)}
                      onContextMenu={(e) => handleContextMenu(e, component.type)}
                      title={t(component.name as any)}
                    >
                      <div className="component-icon">
                        <ComponentIcon name={component.icon} size={24} />
                      </div>
                      <div className="component-name">{t(component.name as any)}</div>
                    </div>
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 右键菜单 */}
      {contextMenu.visible && variants.length > 0 && (
        <div
          ref={menuRef}
          className="component-library-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="context-menu-header">{t('Advanced Widgets' as any)}</div>
          {variants.map((variant, index) => (
            <div
              key={`${variant.type}-${index}`}
              className="context-menu-item"
              onClick={() => handleVariantClick(variant)}
            >
              <span className="context-menu-icon">
                <ComponentIcon name={variant.icon} size={16} />
              </span>
              <span className="context-menu-label">{t(variant.label as any)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ComponentLibrary;
export { componentDefinitions, componentIconMap };
