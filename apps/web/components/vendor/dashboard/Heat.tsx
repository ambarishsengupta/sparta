'use client';
import { useRouter } from 'next/navigation';
import { Heatmap } from '../../ui/charts';
import { ProductPhoto } from '../../ui/ProductPhoto';
import { AGE_GROUPS, itemAgeMatrix, type Filters } from '../../../lib/demo-vendor-retail';

/** Block 5: the top 12 items by age group, units sold, the leading age group of each item outlined. A click on a row opens the product page. */
export function ItemAgeHeatmap({ filters }: { filters: Filters }) {
  const router = useRouter();
  const rows = itemAgeMatrix(filters, 12);
  return (
    <section className="vd-block" aria-labelledby="vd-heat">
      <h2 id="vd-heat">Who buys what</h2>
      <p className="muted">Units sold by age group for the top 12 items. The outlined cell is the age group that buys the item most. Select a row to open the product.</p>
      {rows.length === 0 ? <p className="vd-empty">No items under these filters.</p> : (
        <Heatmap
          title="Units sold by item and age group"
          rowLabels={rows.map((r) => <span key={r.product.id} className="vd-heat-row"><ProductPhoto id={r.product.articleId} name={r.product.name} size="thumb" /><span className="vd-name1">{r.product.name}</span></span>)}
          rowNames={rows.map((r) => r.product.name)}
          columnLabels={[...AGE_GROUPS]}
          values={rows.map((r) => r.values)}
          outline={(row, col) => rows[row]?.leading === col}
          onRowClick={(i) => { const r = rows[i]; if (r) router.push(`/vendor/products/${r.product.id}`); }}
        />
      )}
    </section>
  );
}
