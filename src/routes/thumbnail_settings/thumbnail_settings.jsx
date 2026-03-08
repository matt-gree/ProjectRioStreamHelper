import { Text, Paper, Stack, Alert } from '@mantine/core';

export default function ThumbnailSettings() {
    return (
        <Stack gap="md" maw={700}>
            <Text size="lg" fw={700}>Thumbnail Settings</Text>
            <Paper withBorder p="md">
                <Alert variant="light" color="gray" title="Disconnected">
                    Thumbnail generation is disconnected for MSB.
                </Alert>
            </Paper>
        </Stack>
    );
}
