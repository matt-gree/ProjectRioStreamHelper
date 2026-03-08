import { Text, Paper, Stack, Alert } from '@mantine/core';

export default function Ruleset() {
    return (
        <Stack gap="md" maw={700}>
            <Text size="lg" fw={700}>Ruleset</Text>
            <Paper withBorder p="md">
                <Alert variant="light" color="gray" title="Disconnected">
                    The ruleset/stage strike system is disconnected for MSB.
                </Alert>
            </Paper>
        </Stack>
    );
}
