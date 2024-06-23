import * as React from 'react';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import CancelIcon from '@mui/icons-material/Cancel';
import SettingsIcon from '@mui/icons-material/Settings';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import { FormattedMessage } from 'react-intl';

export default function TSHFields() {
    return (
        <Box sx={{ flexGrow: 1 }}>
            <AppBar 
                position="relative"
                sx={{ mb: 2 }}
            >
                <Toolbar>
                    <IconButton
                        size="large"
                        edge="start"
                        color="inherit"
                        aria-label="menu"
                        sx={{ 
                            mr: 2
                        }}
                    >
                        <MenuIcon />
                    </IconButton>
                    <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
                        TournamentStreamHelper v6.0.0
                    </Typography>
                </Toolbar>
            </AppBar>
            <Stack 
                direction="row" 
                justifyContent="center" 
                alignItems="center" 
                spacing={1}
                sx={{
                    ml: 3,
                    mr: 3
                }}
            >
                    <Button variant="outlined" fullWidth>
                        <FormattedMessage
                            id="fields.set_tournament"
                            defaultMessage="Set Tournament"
                        />
                    </Button>
                    <Button variant="outlined">
                        <CancelIcon />
                    </Button>
            </Stack>
            <Stack 
                direction="row" 
                justifyContent="center" 
                alignItems="center" 
                spacing={1}
                sx={{
                    mt: 1,
                    ml: 3,
                    mr: 3
                }}
            >
                    <Button variant="outlined" fullWidth>
                        <FormattedMessage
                            id="fields.load_from_startgg_user"
                            defaultMessage="Load Tournament and Sets from StartGG User"
                        />
                    </Button>
                    <Button variant="outlined">
                        <SettingsIcon />
                    </Button>
            </Stack>
        </Box>
    )
}