export async function generateStaticParams() {
  return [{ slug: 'a' }];
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  return { title: params.slug };
}

export default function Post({ params }: { params: { slug: string } }) {
  return <h1>{params.slug}</h1>;
}
