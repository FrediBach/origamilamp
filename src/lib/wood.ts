export const WOOD_SPECIES = ['oak', 'ash', 'maple', 'cherry', 'walnut', 'smoked-oak'] as const
export type WoodSpecies = typeof WOOD_SPECIES[number]

interface WoodFinish {
  name: string
  description: string
  color: string
  darkColor: string
  lightColor: string
  roughness: number
  grainContrast: number
  poreStrength: number
}

/** Approximate natural, clear-oiled timber tones, before scene illumination.
 * Colour belongs to the albedo map; it must not be multiplied by a second tint. */
export const WOOD_FINISHES: Record<WoodSpecies, WoodFinish> = {
  oak: { name: 'Oak', description: 'Honey brown · open, flowing grain', color: '#b78f60', darkColor: '#86613d', lightColor: '#caa574', roughness: 0.73, grainContrast: 0.48, poreStrength: 0.8 },
  ash: { name: 'Ash', description: 'Pale straw · bold, open grain', color: '#cbb48b', darkColor: '#9b805a', lightColor: '#dfcba8', roughness: 0.76, grainContrast: 0.53, poreStrength: 0.9 },
  maple: { name: 'Maple', description: 'Creamy blonde · fine, quiet grain', color: '#dfc8a0', darkColor: '#c3a579', lightColor: '#eddbb9', roughness: 0.68, grainContrast: 0.2, poreStrength: 0.12 },
  cherry: { name: 'Cherry', description: 'Warm copper · smooth, flowing grain', color: '#b67a55', darkColor: '#8b5239', lightColor: '#cb9670', roughness: 0.67, grainContrast: 0.34, poreStrength: 0.22 },
  walnut: { name: 'Walnut', description: 'Chocolate brown · rich, varied grain', color: '#79563f', darkColor: '#4c352a', lightColor: '#9a7656', roughness: 0.71, grainContrast: 0.46, poreStrength: 0.42 },
  'smoked-oak': { name: 'Smoked oak', description: 'Deep umber · pronounced oak grain', color: '#6f6250', darkColor: '#453c32', lightColor: '#8f8069', roughness: 0.77, grainContrast: 0.5, poreStrength: 0.8 },
}
