import { useState } from 'react';
import { RouterProvider } from 'react-router-dom';
import { IntlProvider } from 'react-intl';
import { router } from './router';
import { locales } from '../lang/locales';

export default function App() {
    const [usersLocale, setUsersLocale] = useState("en-US");

    return (
        <IntlProvider 
            locale={usersLocale}
            messages={locales[usersLocale].messages}
        >
            <RouterProvider router={router} />
        </IntlProvider>
    )
}