import { TEXT_COLORS } from './text-projection'

export const TEXT_COLOR_OPTIONS = (['black', 'brown', 'beige'] as const).map(id => ({
  id, label: TEXT_COLORS[id].name, color: TEXT_COLORS[id].hex,
}))
