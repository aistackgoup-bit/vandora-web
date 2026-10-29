import React from 'react';
import { supabase } from '../../lib/supabase';
import { adjustInventory, inventoryKey, Variant } from '../../lib/inventory';

export type StockMatrix = Record<string, string>;

const cellKey = (color: string, size: string) => `${inventoryKey(color)}|${inventoryKey(size)}`;

const axes = (colors: { name: string }[], sizes: string[]) => ({
  colorNames: colors.length ? colors.map((c) => c.name) : [''],
  sizeNames: sizes.length ? sizes : [''],
});

// Prefills the grid with the current stock of each variant.
export const matrixFromVariants = (variants: Variant[]): StockMatrix =>
  Object.fromEntries(variants.map((v) => [cellKey(v.color, v.size), String(v.stock)]));

// After the product is saved (its variants are created by the database), records the
// difference between the grid and the current stock as inventory movements.
export const saveVariantStock = async (productId: string, matrix: StockMatrix, isNew: boolean) => {
  const { data, error } = await supabase.from('product_variants').select('*').eq('product_id', productId);
  if (error) throw error;
  const variants = (data || []) as Variant[];

  for (const [key, value] of Object.entries(matrix)) {
    if (value === '' || value == null) continue;
    const target = parseInt(value, 10);
    const variant = variants.find((v) => cellKey(v.color, v.size) === key);
    if (Number.isNaN(target) || !variant || target === variant.stock) continue;
    await adjustInventory(variant.id, target - variant.stock, isNew ? 'initial' : 'adjustment', 'Desde la ficha del producto');
  }
};

const VariantStockEditor = ({ colors, sizes, matrix, onChange, poolStock }: {
  colors: { name: string; code?: string }[];
  sizes: string[];
  matrix: StockMatrix;
  onChange: (m: StockMatrix) => void;
  poolStock?: number;
}) => {
  const { colorNames, sizeNames } = axes(colors, sizes);
  const total = Object.entries(matrix)
    .filter(([k]) => colorNames.some((c) => sizeNames.some((s) => cellKey(c, s) === k)))
    .reduce((acc, [, v]) => acc + (parseInt(v, 10) || 0), 0);

  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <label className="block text-sm font-medium text-gray-700">Stock por color y talla</label>
        <span className="text-xs text-gray-500">Total: {total}{poolStock ? ` + ${poolStock} sin asignar` : ''}</span>
      </div>
      <div className="overflow-x-auto border rounded-md">
        <table className="min-w-full text-sm">
          {sizeNames[0] !== '' && (
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2" />
                {sizeNames.map((s) => <th key={s} className="px-2 py-2 text-xs font-medium text-gray-500">{s}</th>)}
              </tr>
            </thead>
          )}
          <tbody>
            {colorNames.map((c) => (
              <tr key={c} className="border-t first:border-t-0">
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {c ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full border" style={{ backgroundColor: colors.find((x) => x.name === c)?.code || '#ccc' }} />
                      {c}
                    </span>
                  ) : 'Unidades'}
                </td>
                {sizeNames.map((s) => (
                  <td key={s} className="px-2 py-1">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={matrix[cellKey(c, s)] ?? ''}
                      placeholder="0"
                      onChange={(e) => onChange({ ...matrix, [cellKey(c, s)]: e.target.value })}
                      className="w-16 border rounded p-1.5 text-center focus:ring-2 focus:ring-vandora-emerald outline-none"
                      aria-label={`Stock ${[c, s].filter(Boolean).join(' ')}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-1">Escribe las unidades que hay. El cambio queda registrado en el historial de Inventario.</p>
    </div>
  );
};

export default VariantStockEditor;
