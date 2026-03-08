import { Text, Paper, Stack, Alert } from '@mantine/core';

export default function Bracket() {
    return (
        <Stack gap="md" maw={700}>
            <Text size="lg" fw={700}>Bracket</Text>
            <Paper withBorder p="md">
                <Alert variant="light" color="blue" title="Coming Soon">
                    Bracket display will be connected to start.gg / Challonge data providers.
                    This tab will show the tournament bracket and allow match selection.
                </Alert>
            </Paper>
        </Stack>
    );
}
