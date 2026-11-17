import { ItemForm } from '../../../components/wardrobe/ItemForm';
import { padGtin } from '../../../lib/gtin';

/** `?barcode=` comes from the catalogue lookup (FR-26); it is read as a barcode number again here and kept only when it is one (padded to 14 digits). */
export default async function NewItem({ searchParams }: { searchParams: Promise<{ barcode?: string | string[] }> }) {
  const { barcode } = await searchParams;
  return <ItemForm barcode={(typeof barcode === 'string' ? padGtin(barcode) : null) ?? undefined} />;
}
