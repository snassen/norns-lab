#include <jack/jack.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static jack_port_t *left_port;
static jack_port_t *right_port;
static jack_nframes_t rate;
static volatile jack_nframes_t written;
static int frequency = 440;
static int tone_ms = 500;
static int total_ms = 2000;

static int render(jack_nframes_t frames, void *unused) {
  (void)unused;
  jack_default_audio_sample_t *left = jack_port_get_buffer(left_port, frames);
  jack_default_audio_sample_t *right = jack_port_get_buffer(right_port, frames);
  for (jack_nframes_t i = 0; i < frames; ++i) {
    const jack_nframes_t at = written + i;
    const float sample = at >= rate / 4 && at < rate / 4 + rate * tone_ms / 1000
      ? 0.12f * sinf(2.0f * 3.14159265358979323846f * (float)frequency * (float)at / (float)rate)
      : 0.0f;
    left[i] = sample;
    right[i] = sample;
  }
  written += frames;
  return 0;
}

int main(int argc, char **argv) {
  if (argc > 1) frequency = atoi(argv[1]);
  if (argc > 2) tone_ms = atoi(argv[2]);
  if (argc > 3) total_ms = atoi(argv[3]);
  if (frequency < 55 || frequency > 4000 || tone_ms < 50 || tone_ms > 5000 ||
      total_ms < tone_ms + 500 || total_ms > 10000) {
    fprintf(stderr, "Usage: norns-lab-tone [frequency 55-4000] [tone_ms 50-5000] [total_ms > tone_ms+500, <=10000]\n");
    return 2;
  }
  jack_status_t status;
  jack_client_t *client = jack_client_open("norns-lab-tone", JackNoStartServer, &status);
  if (!client) { fprintf(stderr, "Could not open JACK client: %u\n", status); return 1; }
  rate = jack_get_sample_rate(client);
  left_port = jack_port_register(client, "left", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  right_port = jack_port_register(client, "right", JACK_DEFAULT_AUDIO_TYPE, JackPortIsOutput, 0);
  if (!left_port || !right_port || jack_set_process_callback(client, render, NULL) || jack_activate(client)) {
    fprintf(stderr, "Could not start JACK tone\n");
    jack_client_close(client);
    return 1;
  }
  if (jack_connect(client, jack_port_name(left_port), "crone:input_1") ||
      jack_connect(client, jack_port_name(right_port), "crone:input_2")) {
    fprintf(stderr, "Could not connect tone to norns inputs\n");
    jack_client_close(client);
    return 1;
  }
  while (written < rate * total_ms / 1000) usleep(10000);
  jack_client_close(client);
  return 0;
}
