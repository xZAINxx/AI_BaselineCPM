/**
 * Timeline scales only (no gantt.ext.zoom — not bundled in npm build).
 */

import gantt from 'dhtmlx-gantt'

export function applyZoomPreset(level) {
  if (level === 'day') {
    gantt.config.scale_unit = 'day'
    gantt.config.step = 1
    gantt.config.date_scale = '%d %M'
    gantt.config.subscales = [{ unit: 'hour', step: 8, date: '%H' }]
  } else if (level === 'week') {
    gantt.config.scale_unit = 'week'
    gantt.config.step = 1
    gantt.config.date_scale = 'Week %W'
    gantt.config.subscales = [{ unit: 'day', step: 1, date: '%d %M' }]
  } else {
    gantt.config.scale_unit = 'month'
    gantt.config.step = 1
    gantt.config.date_scale = '%M %Y'
    gantt.config.subscales = [{ unit: 'week', step: 1, date: 'W%W' }]
  }
}
