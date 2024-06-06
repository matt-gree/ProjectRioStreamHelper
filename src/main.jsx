import 'vite/modulepreload-polyfill';
import React from 'react'
import ReactDOM from 'react-dom/client';
import {
  createBrowserRouter,
  RouterProvider
} from 'react-router-dom';
import './css/index.css';

// Import all routes
import Root from './routes/root.jsx';

// Create the router
const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    //errorElement: <ErrorPage />,
    children: [
      //{
      //  index: true,
      //  element: <Index />,
      //},
      //{
      //  path: "page/:id",
      //  element: <Page />,
      //}
    ]
  }
])

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
