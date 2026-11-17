import { ItemForm } from '../../../components/wardrobe/ItemForm';
import { ItemPurchases } from '../../../components/purchases/ItemPurchases';

export default async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <ItemForm itemId={id} />
      <ItemPurchases itemId={id} />
    </>
  );
}
