#include <jack/jack.h>
#include <math.h>
#include <stdio.h>
#include <unistd.h>

static jack_port_t *left_port;
static jack_port_t *right_port;
static jack_nframes_t rate;
static volatile jack_nframes_t written;

static int render(jack_nframes_t frames, void *unused) {
  (void)unused;
  jack_default_audio_sample_t *left = jack_port_get_buffer(left_port, frames);
  jack_default_audio_sample_t *right = jack_port_get_buffer(right_port, frames);
  for (jack_nframes_t i = 0; i < frames; ++i) {
    const jack_nframes_t at = written + i;
    const float sample = at >= rate / 4 && at < rate * 3 / 4
      ? 0.12f * sinf(2.0f * 3.14159265358979323846f * 440.0f * (float)at / (float)rate)
      : 0.0f;
    left[i] = sample;
    right[i] = sample;
  }
  written += frames;
  return 0;
}

int main(void) {
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
  while (written < rate * 2) usleep(10000);
  jack_client_close(client);
  return 0;
}
