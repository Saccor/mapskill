export class Store {
  items: string[] = [];
}

export const useStore = () => new Store().items.length;
