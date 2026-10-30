export default function App({ Component, pageProps }: { Component: (p: object) => JSX.Element; pageProps: object }) {
  return <Component {...pageProps} />;
}
