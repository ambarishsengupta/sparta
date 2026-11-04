import { ItemForm } from '../../../components/wardrobe/ItemForm';

export default async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ItemForm itemId={id} />;
}
