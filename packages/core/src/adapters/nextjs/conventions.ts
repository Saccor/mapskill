import { routeFileInfo } from './routes';

/** Exports that Next.js itself calls, so "nobody imports them" is expected. */
export const NEXT_FRAMEWORK_EXPORTS = new Set([
  'default', 'metadata', 'generateMetadata', 'generateStaticParams', 'generateViewport', 'viewport',
  'revalidate', 'dynamic', 'dynamicParams', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration',
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  'config', 'middleware', 'getServerSideProps', 'getStaticProps', 'getStaticPaths',
  'alt', 'size', 'contentType', 'generateImageMetadata', 'generateSitemaps', 'experimental_ppr',
  'proxy', 'register', 'onRequestError', 'useMDXComponents',
]);

const METADATA_FILE = /^(src\/)?app\/(.*\/)?(opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\d*\.[cm]?[jt]sx?$/;
const ROOT_CONVENTION_FILE = /^(src\/)?(proxy|middleware|instrumentation|instrumentation-client|mdx-components)\.[cm]?[jt]sx?$/;

/** True for files that Next.js loads by name: routes, metadata files, proxy/middleware, instrumentation and mdx-components. */
export function isNextConventionFile(file: string): boolean {
  return routeFileInfo(file) !== null || METADATA_FILE.test(file) || ROOT_CONVENTION_FILE.test(file);
}
