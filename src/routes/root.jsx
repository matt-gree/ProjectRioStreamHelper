import { useStoresLoaded } from '../context/store';

import TSHFields from './fields';

export default function Root() {
  const isLoaded = useStoresLoaded();

  return (
    isLoaded ?
    <div style={{ 
      position: 'absolute',
      margin: 0,
      padding: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      height: '100vh'
    }}>
      <TSHFields />
    </div>
    :
    <p>Loading...</p>
  )
}