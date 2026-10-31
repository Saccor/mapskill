// Temporary; Task 8 replaces it.
import { takeToken } from './api';
import { useMapConnection } from './connection';

const { token, cleanUrl } = takeToken(location, sessionStorage);
if (cleanUrl) history.replaceState(null, '', cleanUrl);

function Connected({ token }: { token: string }) {
  const { state } = useMapConnection(token);
  return (
    <p>
      {state.status} · {state.graph?.nodes.length ?? 0} parts
    </p>
  );
}

export function App() {
  return token ? <Connected token={token} /> : <p>No token</p>;
}
