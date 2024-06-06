import { createBrowserRouter } from 'react-router-dom';

// Import all routes
import Root from '../routes/root.jsx';

// Create the router
export const router = createBrowserRouter([
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