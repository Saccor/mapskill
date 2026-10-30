export function useMDXComponents() {
  return { h1: (props: { children?: string }) => <h1>{props.children}</h1> };
}
